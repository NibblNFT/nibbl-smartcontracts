// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { Pausable } from "@openzeppelin/contracts/security/Pausable.sol";
import { NibblVault } from "./NibblVault.sol";
import { SafeMath } from  "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { Proxy } from "./Proxy/Proxy.sol";
import { NibblVaultFactoryData } from "./Utilities/NibblVaultFactoryData.sol";
import { AccessControlMechanism } from "./Utilities/AccessControlMechanism.sol";
import { INibblVaultFactory } from "./Interfaces/INibblVaultfactory.sol";

contract NibblVaultFactory is INibblVaultFactory, AccessControlMechanism, Pausable, NibblVaultFactoryData {
    /// @notice Minimum initial reserve balance a user has to deposit to create a new vault/ Defines minimum valuation
    uint256 private constant MIN_INITIAL_RESERVE_BALANCE = 1e9;

    /// @notice array containing the addresses of all the vaults
    Proxy[] public nibbledTokens;
    constructor (address _vaultImplementation, address _feeTo, address _admin) AccessControlMechanism(_admin) {
        vaultImplementation = _vaultImplementation;
        feeTo = _feeTo;
    }

    /// @notice mints a new vault
    /// @param _assetAddress address of the NFT contract which is being fractionalised
    /// @param _assetTokenID tokenId of the NFT being fractionalised
    /// @param _name name of the fractional token to be created
    /// @param _symbol symbol of the fractional token
    /// @param _initialSupply desired initial token supply
    /// @param _initialTokenPrice desired initial token price
    function createVault(
        address _assetAddress,
        uint256 _assetTokenID,
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _initialTokenPrice
        ) external payable override whenNotPaused returns(address _proxyVaultAddress) {
        require(msg.value >= MIN_INITIAL_RESERVE_BALANCE, "NibblVaultFactory: Initial reserve balance too low");
        require(IERC721(_assetAddress).ownerOf(_assetTokenID) == msg.sender, "NibblVaultFactory: Invalid sender");
        Proxy _proxyVault = new Proxy(payable(address(this)));
        NibblVault _vault = NibblVault(payable(_proxyVault));
        _vault.initialise{value: msg.value}(_name, _symbol, _assetAddress, _assetTokenID, msg.sender, _initialSupply,_initialTokenPrice);
        IERC721(_assetAddress).safeTransferFrom(msg.sender, address(_vault), _assetTokenID);
        nibbledTokens.push(_proxyVault);
        emit Fractionalise(_assetAddress, _assetTokenID, address(_proxyVault));
        return address(_proxyVault);
    }

    function withdrawAdminFee() external override {
        (bool _success, ) = payable(feeTo).call{value: address(this).balance}("");
        require(_success);
    }

    // Cancellation functions aren't required as we can call propose function again with different parameters

    /// @notice proposes new admin fee address
    /// @dev new address can be updated only after timelock
    /// @dev can only be called by FEE_ROLE
    /// @param _newFeeAddress new address to recieve admin fee on address
    function proposeNewAdminFeeAddress(address _newFeeAddress) external override onlyRole(FEE_ROLE) {
        pendingFeeTo = _newFeeAddress;
        feeToUpdateTime = block.timestamp + UPDATE_TIME;
    }

    /// @notice updates new admin fee address
    function updateNewAdminFeeAddress() external override {
        require(feeToUpdateTime != 0 && block.timestamp >= feeToUpdateTime, "NibblVaultFactory: UPDATE_TIME has not passed");
        feeTo = pendingFeeTo;
        delete feeToUpdateTime;
    }

    /// @notice proposes new admin fee
    /// @dev new fee can be updated only after timelock
    /// @dev can only be called by FEE_ROLE
    /// @param _newFee new admin fee 
    function proposeNewAdminFee(uint256 _newFee) external override onlyRole(FEE_ROLE) {
        require(_newFee <= MAX_ADMIN_FEE, "NibblVaultFactory: Fee value greater than MAX_ADMIN_FEE");
        pendingFeeAdmin = _newFee;
        feeAdminUpdateTime = block.timestamp + UPDATE_TIME;
    }

    /// @notice updates new admin fee
    function updateNewAdminFee() external override {
        require(feeAdminUpdateTime != 0 && block.timestamp >= feeAdminUpdateTime, "NibblVaultFactory: UPDATE_TIME has not passed");
        feeAdmin = pendingFeeAdmin;
        delete feeAdminUpdateTime;
    }

    /// @notice proposes new vault implementation
    /// @dev new implementation can be updated only after timelock
    /// @dev can only be called by FEE_ROLE
    /// @param _newVaultImplementation new implementation vault address
    function proposeNewVaultImplementation(address _newVaultImplementation) external override onlyRole(IMPLEMENTER_ROLE) {
        pendingVaultImplementation = _newVaultImplementation;
        vaultUpdateTime = block.timestamp + UPDATE_TIME;
    }

    /// @notice updates new vault implementation
    function updateVaultImplementation() external override {
        require(vaultUpdateTime != 0 && block.timestamp >= vaultUpdateTime, "NibblVaultFactory: UPDATE_TIME has not passed");
        vaultImplementation = pendingVaultImplementation;
        delete vaultUpdateTime;
    }

    /// @notice pauses the system
    /// @dev can only be called by PAUSER_ROLE
    function pause() external onlyRole(PAUSER_ROLE) override {
        _pause();
    }

    /// @notice unpauses the system
    /// @dev can only be called by PAUSER_ROLE
    function unPause() external onlyRole(PAUSER_ROLE) override {
        _unpause();
    }

    receive() payable external {    }

}