// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { BancorBondingCurve } from "./Bancor/BancorBondingCurve.sol";
import { IERC721Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import { IERC721ReceiverUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import { SafeMathUpgradeable } from  "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import { IERC721ReceiverUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import { DataStructure } from "./DataStructure/DataStructure.sol";
import "hardhat/console.sol";


//solhint-disable reason-string
// is BancorBondingCurve, ERC20, DataStructure, Initializable 
contract SingleCurveVault is BancorBondingCurve, ERC20Upgradeable, IERC721ReceiverUpgradeable {
    //
    enum Status { Uninitialized, Initialized, BuyoutInitiated, BuyoutSuccessful }

    uint32 private constant _SCALE = 1e6;

    // reserveRatio of BancorBondingCurve
    ///@dev scale is 1e6 (0%-100%) = (0 - 1e6)
    ///@dev reserveRatio is 50% = .5 = .5 * _SCALE = 500000
    uint32 public reserveRatio;

    // fee levied on each trade that goes to admin -> between (0-100%) 
    /// @dev Scale = 1e6
    uint32 public feeAdmin;

    // fee levied on each trade that goes to curator -> between (0-100%) 
    /// @dev Scale = 1e6
    uint32 public feeCurator; 

    // buyout rejection premium
    ///@dev scale is 1e6 (0%-100%) = (0 - 1e6)
    ///@dev rejectionPremium is 10% = .1 = .1 * _SCALE = 100000
    uint32 public rejectionPremium; 

    /// @notice ReserveTokenBalance of contract
    uint256 public reserveBalance;

    /// @notice reserveBalance of unminted but reserved supply
    uint256 public fictitiousReserveBalance;

    /// @notice supply reserved for curator
    /// @dev Explain to a developer any extra details
    /// @return Documents the return variables of a contract’s function state variable
    uint256 public reservedContinousSupply;

    ///@notice address who deposited the NFT(s)
    address public curator; 

    address public assetAddress;

    uint256 public assetTokenID;

    /// @notice Current status of the vault
    Status public status;

    DataStructure.Fee public fee;

    DataStructure.Asset public asset;

    modifier isTrading() {
        require(status == Status.Initialized || status == Status.BuyoutInitiated, "SingleCurveVault: Trading not allowed" );
        _;
    }

    function initialize(
        DataStructure.Asset memory _asset,
        string memory _tokenName, 
        string memory _tokenSymbol, 
        address _curator, 
        uint32 _reserveRatio,
        DataStructure.Fee memory _fee,
        uint32 _buyoutRejectionPremium,
        uint256 _reservedContinousSupply,
        uint256 _initialUnlockAmount
        ) external initializer payable{
        __ERC20_init(_tokenName, _tokenSymbol);
            asset = _asset;
            curator = _curator;
            reserveRatio = _reserveRatio;
            fee = _fee;
            rejectionPremium = _buyoutRejectionPremium;
            reservedContinousSupply = _reservedContinousSupply;
            fictitiousReserveBalance = (_reservedContinousSupply * _reserveRatio * 1e14)/( uint256(_SCALE) * 1e18); ///initial Price 1e14 => 10^-4 eth
            status = Status.Initialized;
            if(msg.value != 0) unlockReservedSupply(_initialUnlockAmount);
        }

    function _currentSupply() private view returns(uint256) {
        return totalSupply() + reservedContinousSupply;
    }

    function _effectiveReserveBalance() private view returns(uint256) {
        return fictitiousReserveBalance + reserveBalance;
    }

    function unlockReservedSupply(uint256 _unlockAmount) public payable {   
        uint _reservedContinousSupply = reservedContinousSupply;
        uint _fictitiousReserveBalance = fictitiousReserveBalance;     
        require(_unlockAmount <= _reservedContinousSupply, "SingleCurveVault: unlock exceeds reserved liquidity");
        require(msg.value <= _fictitiousReserveBalance, "SingleCurveVault: value exceeds reserve balance");
        uint256 _calculatedUnlockAmount;

        if (msg.value == _fictitiousReserveBalance) {
            _mint(curator, _reservedContinousSupply);
            delete fictitiousReserveBalance;
            delete reservedContinousSupply;
        } else {
            _fictitiousReserveBalance -= msg.value;
            _calculatedUnlockAmount = _calculatePurchaseReturn(_reservedContinousSupply - _unlockAmount, _fictitiousReserveBalance, reserveRatio, msg.value);
            require(_unlockAmount <= _calculatedUnlockAmount, "SingleCurveVault: Invalid unlock amount");
            _mint(curator, _calculatedUnlockAmount);
            reservedContinousSupply -= _calculatedUnlockAmount;
            fictitiousReserveBalance = _fictitiousReserveBalance;
        }   
        reserveBalance += msg.value;
    }



    function _calculateFee(uint256 _amount) private view returns(uint256, uint256) {
        return ((_amount * (feeAdmin)) / (_SCALE), (_amount * (feeCurator)) / (_SCALE));
    }

    //TODO: remove if not required
    function _getCurvePrice() private view returns(uint256) {
        return _SCALE * reserveBalance/((reserveRatio) * _currentSupply());
    }


    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}