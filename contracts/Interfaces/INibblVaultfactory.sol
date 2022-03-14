// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;
interface INibblVaultFactory {
    event Fractionalise(address assetAddress, uint256 assetTokenID, address proxyVault);

    function createVault(address _assetAddress, uint256 _assetTokenID, string memory _name, string memory _symbol, uint256 _initialSupply, uint256 _initialTokenPrice) external payable returns(address _proxyVault);
    function withdrawAdminFee() external;
    function proposeNewAdminFeeAddress(address _newFeeAddress) external;
    function updateNewAdminFeeAddress() external;
    function proposeNewAdminFee(uint256 _newFee) external;
    function updateNewAdminFee() external;
    function proposeNewVaultImplementation(address _newVaultImplementation) external;
    function updateVaultImplementation() external;
    function pause() external;
    function unPause() external;
}