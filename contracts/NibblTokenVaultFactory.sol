// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.0;
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { SingleCurveNibblVault } from "./SingleCurveNibblVault.sol";
import { SafeMath } from  "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { ProxyVault } from "./Proxy/ProxyVault.sol";
import "hardhat/console.sol";

contract NibblTokenVaultFactory is Ownable{

    ProxyVault[] public nibbledTokens;

    address public singleCurveVaultImplementation;
    address public multiCurveVaultImplementation;
    
    //Scale = 1e6
    uint32 public reserveRatio;
    uint32 public fee;
    uint32 public buyoutRejectionPremium;

    //TODO: add multiCurveVaultImplementation address to constructor
    constructor (address _singleCurveNibblVaultImplementation, uint32 _reserveRatio, uint32 _fee, uint32 _buyoutRejectionPremium) {
        singleCurveVaultImplementation = _singleCurveNibblVaultImplementation;
        reserveRatio = _reserveRatio;
        fee = _fee;
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
        uint256 _totalSupply
    ) public payable returns(ProxyVault _vault){
        _vault = new ProxyVault(singleCurveVaultImplementation);
        SingleCurveNibblVault(address(_vault)).initialize{value: msg.value}(_assetAddress, _assetTokenID, _name, _symbol, msg.sender, _totalSupply, reserveRatio, fee, buyoutRejectionPremium);
        IERC721(_assetAddress).transferFrom(msg.sender, address(_vault), _assetTokenID);
        nibbledTokens.push(_vault);
    }

}