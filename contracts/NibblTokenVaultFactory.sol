// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SingleCurveVault } from "./SingleCurveVault.sol";
import { SafeMath } from  "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { ProxyVault } from "./Proxy/ProxyVault.sol";
import { DataStructure } from "./DataStructure/DataStructure.sol";
import "hardhat/console.sol";

contract NibblTokenVaultFactory is Ownable{

    ProxyVault[] public nibbledTokens;

    address public implementation;
    
    //Scale = 1e6
    uint32 public reserveRatio;
    uint32 public feeAdmin;
    uint32 public feeCurator;
    uint32 public buyoutRejectionPremium;

    //TODO: add multiCurveVaultImplementation address to constructor
    constructor (address _implementation, uint32 _reserveRatio, uint32 _feeAdmin, uint32 _feeCurator, uint32 _buyoutRejectionPremium) {
        implementation = _implementation;
        reserveRatio = _reserveRatio;
        feeAdmin = _feeAdmin;
        feeCurator = _feeCurator;
        buyoutRejectionPremium = _buyoutRejectionPremium;
    }

    
    /// @notice the function to mint a new vault
    /// @param name the desired name of the vault
    /// @param symbol the desired sumbol of the vault
    // @param _assets the ERC721 token address and tokenId 
    /// @dev _reserveBalance = valuation * reserveRatio
    /// @dev initial Price is always fixed (default is 0.0001 ETH)
    /// @dev initialTokenSupply = _reserveBalance/(price*reserveRatio)
    function createSingleCurveVault(
        address _assetAddress,
        uint256 _assetTokenID,
        string calldata _name,
        string calldata _symbol,
        uint256 _reservedContinousSupply,
        uint256 _initialUnlockAmount
    ) public payable returns(ProxyVault _proxyVault){
        _proxyVault = new ProxyVault(implementation);
        SingleCurveVault _vault = SingleCurveVault(address(_proxyVault));
        _vault.initialize{value: msg.value}(DataStructure.Asset(_assetAddress, _assetTokenID), _name, _symbol, msg.sender, reserveRatio, DataStructure.Fee(feeAdmin, feeCurator) , buyoutRejectionPremium, _reservedContinousSupply, _initialUnlockAmount);
        IERC721(_assetAddress).transferFrom(msg.sender, address(_vault), _assetTokenID);
        nibbledTokens.push(_proxyVault);
    }
}