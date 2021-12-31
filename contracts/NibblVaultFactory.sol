// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { NibblVault } from "./NibblVault.sol";
import { SafeMath } from  "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { ProxyVault } from "./Proxy/ProxyVault.sol";
import "hardhat/console.sol";

contract NibblVaultFactory is Ownable{
//TODO: Add pending functions
    address public implementation;
    address public feeTo;
     
    uint256 public feeAdmin = 2_000;

    uint256 private constant MAX_ADMIN_FEE = 2_000; //.2%
    uint256 private constant MIN_INITIAL_RESERVE_BALANCE = 1e9; //1%

    ProxyVault[] public nibbledTokens;
    
    constructor (address _implementation, address _feeTo) {
        implementation = _implementation;
        feeTo = _feeTo;
    }
    
    /// @notice the function to mint a new vault
    /// @param _assetAddress the desired name of the vault
    /// @param _assetTokenID the desired symbol of the vault
    /// @param _name the desired symbol of the vault
    /// @param _symbol the desired symbol of the vault
    /// @param _initialSupply the desired symbol of the vault
    /// @param _initialTokenPrice the desired symbol of the vault
    /// @param _curatorFee the desired symbol of the vault
    /// @dev _reserveBalance = valuation * reserveRatio
    /// @dev initialTokenSupply = _reserveBalance/(_initialTokenPrice*reserveRatio)
    function createVault(
        address _assetAddress,
        uint256 _assetTokenID,
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _initialTokenPrice,
        uint256 _curatorFee
    ) public payable returns(ProxyVault _proxyVault) {
        require(msg.value >= MIN_INITIAL_RESERVE_BALANCE);
        _proxyVault = new ProxyVault(implementation);
        NibblVault _vault = NibblVault(address(_proxyVault));
        _vault.initialize{value: msg.value}(_name, _symbol, _assetAddress, _assetTokenID, msg.sender, _initialSupply,_initialTokenPrice,_curatorFee);
        IERC721(_assetAddress).transferFrom(msg.sender, address(_vault), _assetTokenID);
        nibbledTokens.push(_proxyVault);
    }

    /// @notice the function to mint a new vault
    /// @param _newFeeAddress the desired name of the vault
    function updateAdminFeeAddress(address _newFeeAddress) public {
        feeTo = _newFeeAddress;
    }

    /// @notice the function to mint a new vault
    /// @param _newFee the desired name of the vault
    function updateFee(uint256 _newFee) public {
        require(_newFee <= MAX_ADMIN_FEE,"NibblVaultFactory: New fee value is greater than max fee allowed");
        feeAdmin = _newFee;
    }

    /// @notice the function to mint a new vault
    function getFee() external view returns(address, uint256) {
        return (feeTo, feeAdmin);
    }
}