// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { Pausable } from "@openzeppelin/contracts/security/Pausable.sol";
import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
import { NibblVault } from "./NibblVault.sol";
import { SafeMath } from  "@openzeppelin/contracts/utils/math/SafeMath.sol";
import { Proxy } from "./Proxy/Proxy.sol";
import { Basket } from "./Basket.sol";
import { NibblVaultFactoryData } from "./Utilities/NibblVaultFactoryData.sol";
import { AccessControlMechanism } from "./Utilities/AccessControlMechanism.sol";

contract NibblVaultFactory is AccessControlMechanism, Pausable, NibblVaultFactoryData {

    uint256 private constant MIN_INITIAL_RESERVE_BALANCE = 1e9;

    Proxy[] public nibbledTokens;

    event Fractionalise(address assetAddress, uint256 assetTokenID, address proxyVault);
    event FractionaliseBasket(address basketAddress, address proxyVault);

    constructor (address _vaultImplementation, address _basketImplementation, address _feeTo, address _admin) {
        vaultImplementation = _vaultImplementation;
        basketImplementation = _basketImplementation;        
        feeTo = _feeTo;
        bytes32 _defaultAdminRole = DEFAULT_ADMIN_ROLE;
        _grantRole(_defaultAdminRole, _admin);
        _setRoleAdmin(_defaultAdminRole, _defaultAdminRole);
        _setRoleAdmin(FEE_ROLE, _defaultAdminRole);
        _setRoleAdmin(PAUSER_ROLE, _defaultAdminRole);
        _setRoleAdmin(IMPLEMENTER_ROLE, _defaultAdminRole);
    }

    /// @notice the function to mint a new vault
    /// @param _assetAddress address of the NFT contract which is being fractionalised
    /// @param _assetTokenID tokenId of the NFT being fractionalised
    /// @param _name name of the fractional token to be created
    /// @param _symbol symbol of the fractional token
    /// @param _initialSupply desired initial token supply
    /// @param _initialTokenPrice desired initial token price
    /// @param _curatorFee fee percentage for curator
    function createVault(
        address _assetAddress,
        uint256 _assetTokenID,
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _initialTokenPrice,
        uint256 _curatorFee
    ) external payable whenNotPaused returns(Proxy _proxyVault) {
        require(msg.value >= MIN_INITIAL_RESERVE_BALANCE, "NibblVaultFactory: Initial reserve balance too low");
        _proxyVault = new Proxy(vaultImplementation);
        NibblVault _vault = NibblVault(payable(_proxyVault));
        _vault.initialise{value: msg.value}(_name, _symbol, _assetAddress, _assetTokenID, msg.sender, _initialSupply,_initialTokenPrice,_curatorFee);
        IERC721(_assetAddress).safeTransferFrom(msg.sender, address(_vault), _assetTokenID);
        nibbledTokens.push(_proxyVault);
        emit Fractionalise(_assetAddress, _assetTokenID, address(_proxyVault));
    }
    
    // this function should be called from a contract which performs important safety checks
    function createMultiVaultERC721(
        address[] memory _assetAddressesERC721,
        uint256[] memory _assetTokenIDsERC721,
        string memory _name,
        string memory _symbol,
        uint256 _initialSupply,
        uint256 _initialTokenPrice,
        uint256 _curatorFee
    ) external payable whenNotPaused returns(Proxy _proxyVault, Proxy _proxyBasket ) {
        require(msg.value >= MIN_INITIAL_RESERVE_BALANCE, "NibblVaultFactory: Initial reserve balance too low");
        _proxyBasket = new Proxy(basketImplementation);
        Basket _basket = Basket(payable(_proxyBasket));
        _basket.initialise();
        for (uint256 index = 0; index < _assetAddressesERC721.length; index++) {
            IERC721(_assetAddressesERC721[index]).transferFrom(msg.sender, address(_proxyBasket), _assetTokenIDsERC721[index]);
        }
        _proxyVault = new Proxy(vaultImplementation);
        NibblVault _vault = NibblVault(payable(_proxyVault));
        _vault.initialise{value: msg.value}(_name, _symbol, address(_proxyBasket), 0, msg.sender, _initialSupply,_initialTokenPrice,_curatorFee);
        IERC721(address(_proxyBasket)).safeTransferFrom(address(this), address(_vault), 0);
        nibbledTokens.push(_proxyVault);
        emit FractionaliseBasket(address(_proxyBasket), address(_proxyVault));
    }
    
    function setRoleAdmin(bytes32 role, bytes32 adminRole) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender));
        _setRoleAdmin(role, adminRole);
    }


    function withdrawAdminFee() external {
        (bool _success, ) = payable(feeTo).call{value: address(this).balance}("");
        require(_success);
    }

    function proposeNewAdminFeeAddress(address _newFeeAddress) external onlyRole(FEE_ROLE) {
        pendingFeeTo = _newFeeAddress;
        feeToUpdateTime = block.timestamp + UPDATE_TIME;
    }

    function updateNewAdminFeeAddress() external {
        require(block.timestamp >= feeToUpdateTime, "NibblVaultFactory: UPDATE_TIME has not passed");
        feeTo = pendingFeeTo;
    }

    /// @notice Function to update admin fee percentage
    /// @param _newFee new fee percentage for admin
    function proposeNewAdminFee(uint256 _newFee) external onlyRole(FEE_ROLE) {
        require(_newFee <= MAX_ADMIN_FEE, "NibblVaultFactory: Fee value greater than MAX_ADMIN_FEE");
        pendingFeeAdmin = _newFee;
        feeAdminUpdateTime = block.timestamp + UPDATE_TIME;
    }

    function updateNewAdminFee() external {
        require(block.timestamp >= feeAdminUpdateTime, "NibblVaultFactory: UPDATE_TIME has not passed");
        feeAdmin = pendingFeeAdmin;
    }

    function proposeNewVaultImplementation(address _newVaultImplementation) external onlyRole(IMPLEMENTER_ROLE) {
        pendingVaultImplementation = _newVaultImplementation;
        vaultUpdateTime = block.timestamp + UPDATE_TIME;
    }

    function updateVaultImplementation() external {
        require(block.timestamp >= vaultUpdateTime, "NibblVaultFactory: UPDATE_TIME has not passed");
        vaultImplementation = pendingVaultImplementation;
    }
    
    function proposeNewBasketImplementation(address _basketImplementation) external onlyRole(IMPLEMENTER_ROLE) {
        pendingBasketImplementation = _basketImplementation;
        basketUpdateTime = block.timestamp + UPDATE_TIME;
    }

    function updateBasketImplementation() external {
        require(block.timestamp >= basketUpdateTime, "NibblVaultFactory: UPDATE_TIME has not passed");
        basketImplementation = pendingBasketImplementation;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unPause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    receive() payable external {

    }

}