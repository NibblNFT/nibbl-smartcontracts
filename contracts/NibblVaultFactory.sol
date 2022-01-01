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
    /// @param _assetAddress address of the NFT contract which is being fractionalised
    /// @param _assetTokenID tokenId of the NFT being fractionalised
    /// @param _name name of the fractional token to be created
    /// @param _symbol symbol fo the fractional token
    /// @param _initialSupply desired initial token supply
    /// @param _initialTokenPrice desired initial token price
    /// @param _curatorFee fee percentage for curator
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

    /// @notice the function to update the address where fee is sent
    /// @param _newFeeAddress new admin fee address
    function updateAdminFeeAddress(address _newFeeAddress) public onlyOwner{
        feeTo = _newFeeAddress;
    }

    /// @notice the function to update admin fee percentage
    /// @param _newFee new fee percentage for admin
    function updateFee(uint256 _newFee) public onlyOwner{
        require(_newFee <= MAX_ADMIN_FEE,"NibblVaultFactory: New fee value is greater than max fee allowed");
        feeAdmin = _newFee;
    }

    /// @notice the function to mint a new vault
    function getFee() external view returns(address, uint256) {
        return (feeTo, feeAdmin);
    }
}