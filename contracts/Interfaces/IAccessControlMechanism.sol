// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (access/AccessControl.sol)

pragma solidity ^0.8.0;

interface IAccessControlMechanism {

    function setRoleAdmin(bytes32 _role, bytes32 _adminRole) external;

    function proposeGrantRole(bytes32 _role, address _to) external;
    
    function claimRole(bytes32 _role) external;


}