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
    /// @param name the desired name of the vault
    /// @param symbol the desired sumbol of the vault
    // @param _assets the ERC721 token address and tokenId 
    /// @dev _reserveBalance = valuation * reserveRatio
    /// @dev initial Price is always fixed (default is 0.0001 ETH)
    /// @dev initialTokenSupply = _reserveBalance/(price*reserveRatio)
    function createVault(
        address _assetAddress,
        uint256 _assetTokenID,
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _initialTokenPrice
    ) public payable returns(ProxyVault _proxyVault) {
        require(msg.value >= MIN_INITIAL_RESERVE_BALANCE);
        _proxyVault = new ProxyVault(implementation);
        NibblVault _vault = NibblVault(address(_proxyVault));
        _vault.initialize{value: msg.value}(_name, _symbol, _assetAddress, _assetTokenID, msg.sender, _initialSupply,_initialTokenPrice);
        IERC721(_assetAddress).transferFrom(msg.sender, address(_vault), _assetTokenID);
        nibbledTokens.push(_proxyVault);
    }
    function updateAdminFeeAddress(address _newFeeAddress) public onlyOwner{
        feeTo = _newFeeAddress;
    }
    function updateFee(uint256 _newFee) public onlyOwner{
        require(_newFee<MAX_ADMIN_FEE,"NibblVaultFactory: New fee value is greater than max fee allowed");
        feeAdmin = _newFee;
    }

    function getFee() external view returns(address, uint256) {
        return (feeTo, feeAdmin);
    }
}