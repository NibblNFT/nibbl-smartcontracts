// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.10;
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { Pausable } from "@openzeppelin/contracts/security/Pausable.sol";
import { NibblVault } from "./NibblVault.sol";
import { SafeMath } from  "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { ProxyVault } from "./Proxy/ProxyVault.sol";
import { ProxyBasket } from "./Proxy/ProxyBasket.sol";
import { NibblVaultFactoryData } from "./Utilities/NibblVaultFactoryData.sol";
import { AccessControlMechanism } from "./Utilities/AccessControlMechanism.sol";
import { INibblVaultFactory } from "./Interfaces/INibblVaultFactory.sol";
import { Basket } from "./Basket.sol";

contract NibblVaultFactory is INibblVaultFactory, AccessControlMechanism, Pausable, NibblVaultFactoryData {
    /// @notice Minimum initial reserve balance a user has to deposit to create a new vault/ Defines minimum valuation
    uint256 private constant MIN_INITIAL_RESERVE_BALANCE = 1e9;

    /// @notice array containing the addresses of all the vaults
    ProxyVault[] public nibbledTokens;
    constructor (address _vaultImplementation, address _feeTo, address _admin, address _basketImplementation) AccessControlMechanism(_admin) {
        vaultImplementation = _vaultImplementation;
        feeTo = _feeTo;
        basketImplementation = _basketImplementation;
    }

    /// @notice mints a new vault
    /// @param _assetAddress address of the NFT contract which is being fractionalised
    /// @param _curator address of curator
    /// @param _name name of the fractional token to be created
    /// @param _symbol symbol of the fractional token
    /// @param _assetTokenID tokenId of the NFT being fractionalised
    /// @param _initialSupply desired initial token supply
    /// @param _initialTokenPrice desired initial token price
    /// @param _minBuyoutTime minimum time after which buyout can be triggered
    function createVault(
        address _assetAddress,
        address _curator,
        string memory _name,
        string memory _symbol,
        uint256 _assetTokenID,
        uint256 _initialSupply,
        uint256 _initialTokenPrice,
        uint256 _minBuyoutTime
        ) external payable override whenNotPaused returns(address payable _proxyVault) {
        require(msg.value >= MIN_INITIAL_RESERVE_BALANCE, "NibblVaultFactory: Initial reserve balance too low");
        require(IERC721(_assetAddress).ownerOf(_assetTokenID) == msg.sender, "NibblVaultFactory: Invalid sender");
        _proxyVault = payable(new ProxyVault{salt: keccak256(abi.encodePacked(_curator, _assetAddress, _assetTokenID, _initialSupply, _initialTokenPrice))}(payable(address(this))));
        NibblVault _vault = NibblVault(payable(_proxyVault));
        _vault.initialize{value: msg.value}(_name, _symbol, _assetAddress, _assetTokenID, _curator, _initialSupply,_initialTokenPrice, _minBuyoutTime);
        IERC721(_assetAddress).safeTransferFrom(msg.sender, address(_vault), _assetTokenID);
        nibbledTokens.push(ProxyVault(_proxyVault));
        emit Fractionalise(_assetAddress, _assetTokenID, _proxyVault);
    }

    /// @notice get address of vault to be deployed
    /// @param _curator address of curator
    /// @param _assetAddress address of the NFT contract which is being fractionalised
    /// @param _assetTokenID tokenId of the NFT being fractionalised
    /// @param _initialSupply desired initial token supply
    /// @param _initialTokenPrice desired initial token price    
    function getVaultAddress(
        address _curator,
        address _assetAddress,
        uint256 _assetTokenID,
        uint256 _initialSupply,
        uint256 _initialTokenPrice) public view returns(address _vault) {
        bytes32 newsalt = keccak256(abi.encodePacked(_curator, _assetAddress, _assetTokenID,  _initialSupply, _initialTokenPrice));
        bytes memory code = abi.encodePacked(type(ProxyVault).creationCode, uint256(uint160(address(this))));
        bytes32 _hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), newsalt, keccak256(code)));
        _vault = address(uint160(uint256(_hash)));     
    }

    function getVaults() public view returns(ProxyVault[] memory ) {
        return nibbledTokens;
    }

    function createBasket(address _curator, string memory _mix) public override returns(address)  {
        address payable _basketAddress = payable(new ProxyBasket{salt: keccak256(abi.encodePacked(_curator, _mix))}(basketImplementation));
        Basket _basket = Basket(_basketAddress);
        _basket.initialise(_curator);
        emit BasketCreated(_curator, _basketAddress);
        return _basketAddress;
    }

    function getBasketAddress(address _curator, string memory _mix) public override view returns(address _basket) {
        bytes32 newsalt = keccak256(abi.encodePacked(_curator, _mix));
        bytes memory code = abi.encodePacked(type(ProxyBasket).creationCode, uint256(uint160(basketImplementation)));
        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), newsalt, keccak256(code)));
        _basket = address(uint160(uint256(hash)));     
    }

    /// @notice proposes new Basket implementation
    /// @dev new implementation can be updated only after timelock
    /// @dev can only be called by IMPLEMENTER_ROLE
    /// @param _newBasketImplementation new implementation basket address
    function proposeNewBasketImplementation(address _newBasketImplementation) external override onlyRole(IMPLEMENTER_ROLE) {
        pendingBasketImplementation = _newBasketImplementation;
        basketUpdateTime = block.timestamp + UPDATE_TIME;
    }

    /// @notice updates new basket implementation
    /// @dev new vault implementation can be updated only after timelock
    function updateBasketImplementation() external override {
        require(basketUpdateTime != 0 && block.timestamp >= basketUpdateTime, "NibblVaultFactory: UPDATE_TIME has not passed");
        basketImplementation = pendingBasketImplementation;
        delete basketUpdateTime;
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
    /// @dev can only be updated after timelock
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
    /// @dev new fee can be updated only after timelock
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
    /// @dev new vault implementation can be updated only after timelock
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