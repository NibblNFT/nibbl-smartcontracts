// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

contract NibblVaultFactoryData {
    uint public UPDATE_TIME = 2 days;
    uint256 public constant MAX_ADMIN_FEE = 2_000; //.2%

    address public vaultImplementation;
    address public pendingVaultImplementation;
    uint public vaultUpdateTime; //Cooldown period

    address public feeTo;
    address public pendingFeeTo;
    uint public feeToUpdateTime; //Cooldown period  

    uint256 public feeAdmin = 2_000;
    uint256 public pendingFeeAdmin;
    uint256 public feeAdminUpdateTime; //Cooldown period
}