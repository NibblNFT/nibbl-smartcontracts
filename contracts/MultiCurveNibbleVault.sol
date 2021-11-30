// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.0;

// import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
// import { BancorBondingCurve } from "./Bancor/BancorBondingCurve.sol";
// import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
// import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
// import { DataStructure } from "./DataStructures/IDataStructure.sol";
// import { SafeMath } from  "@openzeppelin/contracts/utils/math/SafeMath.sol";
// import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
// import "hardhat/console.sol";


// //solhint-disable reason-string
// // is BancorBondingCurve, ERC20, DataStructure, Initializable 
// contract MultiCurveNibblVault is BancorBondingCurve, ERC20Upgradeable {
//     //
//     using SafeMath for uint256;

//     enum Status { Uninitialized, Initialized, BuyoutInitiated, BuyoutSuccessful }

//     uint32 private constant _SCALE = 1e6;

//     // reserveRatio of BancorBondingCurve
//     ///@dev scale is 1e6 (0%-100%) = (0 - 1e6)
//     ///@dev reserveRatio is 50% = .5 = .5 * _SCALE = 500000
//     uint32 private constant _RESERVE_RATIO = 500000;

//     // fee levied on each trade between (0-100%) 
//     /// @dev Scale = 1e6
//     /// @dev fee is 1% => .01*_SCALE =10000
//     uint32 private constant _FEE = 10000; 

//     // buyout rejection premium
//     ///@dev scale is 1e6 (0%-100%) = (0 - 1e6)
//     ///@dev buyoutRejectionPremium is 10% = .1 = .1 * _SCALE = 100000
//     uint32 private constant _BUYOUT_REJECTION_PREMIUM = 100000; 

//     /// @notice ReserveBalance of contract
//     uint256 public reserveBalance;

//     ///@notice address who deposited the NFT(s)
//     address public curator; 
    

//     /// @notice initialTokenSupply of curve. This will be reserved for curator
//     /// @dev Explain to a developer any extra details
//     /// @return Documents the return variables of a contract’s function state variable
//     uint256 public initialTokenSupply;

//     /// @notice Current status of the vault
//     Status public status;

//     function initialize(
//         string memory _tokenName, 
//         string memory _tokenSymbol, 
//         address _curator, 
//         uint _initialTokenSupply
//         ) external payable initializer {
//             __ERC20_init(_tokenName, _tokenSymbol);
//             curator = _curator;
//             initialTokenSupply = _initialTokenSupply;
//             reserveBalance = msg.value;
//             status = Status.Initialized;    
//             // _mint(curator, _initialTokenSupply);
//     }

//     function getCurvePrice() public view returns(uint256){
//         return _SCALE * reserveBalance/((_RESERVE_RATIO)*totalSupply());
//     }

// }