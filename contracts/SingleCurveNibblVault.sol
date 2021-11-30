// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.0;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { BancorBondingCurve } from "./Bancor/BancorBondingCurve.sol";
import { IERC721Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import { IERC721ReceiverUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import { SafeMathUpgradeable } from  "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import { IERC721ReceiverUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import "hardhat/console.sol";


//solhint-disable reason-string
// is BancorBondingCurve, ERC20, DataStructure, Initializable 
contract SingleCurveNibblVault is BancorBondingCurve, ERC20Upgradeable, IERC721ReceiverUpgradeable {
    //
    using SafeMathUpgradeable for uint256;

    enum Status { Uninitialized, Initialized, BuyoutInitiated, BuyoutSuccessful }

    uint32 private constant _SCALE = 1e6;

    // reserveRatio of BancorBondingCurve
    ///@dev scale is 1e6 (0%-100%) = (0 - 1e6)
    ///@dev reserveRatio is 50% = .5 = .5 * _SCALE = 500000
    uint32 public reserveRatio;

    // fee levied on each trade between (0-100%) 
    /// @dev Scale = 1e6
    /// @dev fee is 1% => .01*_SCALE =10000
    uint32 public fee; 

    // buyout rejection premium
    ///@dev scale is 1e6 (0%-100%) = (0 - 1e6)
    ///@dev buyoutRejectionPremium is 10% = .1 = .1 * _SCALE = 100000
    uint32 public buyoutRejectionPremium; 

    /// @notice ReserveTokenBalance of contract
    uint256 public reserveTokenBalance;

    /// @notice reserveTokenBalance of unminted but reserved supply
    uint256 public fictitiousReserveBalance;

    /// @notice supply reserved for curator
    /// @dev Explain to a developer any extra details
    /// @return Documents the return variables of a contract’s function state variable
    uint256 public reservedTokenSupply;

    ///@notice address who deposited the NFT(s)
    address public curator; 

    address public assetAddress;

    uint256 public assetTokenID;

    /// @notice Current status of the vault
    Status public status;

    modifier isTrading() {
        require(status == Status.Initialized || status == Status.BuyoutInitiated, "Trading not allowed" );
        _;
    }

    function initialize(
        address _assetsAddress,
        uint256 _assetTokenID,
        string memory _tokenName, 
        string memory _tokenSymbol, 
        address _curator, 
        uint256 _initialTokenSupply,
        uint32 _reserveRatio,
        uint32 _fee,
        uint32 _buyoutRejectionPremium
        
        ) external payable initializer {
            __ERC20_init(_tokenName, _tokenSymbol);

            assetAddress = _assetsAddress;
            assetTokenID = _assetTokenID;
            curator = _curator;
            reserveRatio = _reserveRatio;
            fee = _fee;
            buyoutRejectionPremium = _buyoutRejectionPremium;
            reservedTokenSupply = _initialTokenSupply;
            reserveTokenBalance = msg.value;
            fictitiousReserveBalance = _initialTokenSupply.mul(_reserveRatio).mul(1e14); ///initial Price 1e14 => 10^-4 eth
            status = Status.Initialized;    
            if (msg.value != 0) {
                unlockReservedLiquidity();    
            }
        }

    function _currentSupply() private view returns(uint256) {
        return totalSupply() + reservedTokenSupply;
    }

    function unlockReservedLiquidity() public payable {
            uint256 _tokensUnlocked =  reservedTokenSupply.mul(uint(1).sub(uint(1).sub(msg.value.div(reserveTokenBalance))) ** (reserveRatio));
            reservedTokenSupply = reservedTokenSupply.sub(_tokensUnlocked);
            _mint(curator, _tokensUnlocked);
    }

    function mintTokens(address _to) external {
//  function _calculatePurchaseReturn(
//     uint256 _supply,
//     uint256 _reserveBalance,
//     uint32 _reserveRatio,
//     uint256 _depositAmount) 

    uint256 purchaseReturn ;
    }


    function burnTokens() external {
        
    }


    function _deductFee(uint256 _amount) private view returns(uint256) {
        return _amount.sub(_amount.mul(fee).div(_SCALE));
    }

    //TODO: remove if not required
    function _getCurvePrice() private view returns(uint256) {
        return _SCALE * reserveTokenBalance/((reserveRatio) * _currentSupply());
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