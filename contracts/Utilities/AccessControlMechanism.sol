// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (access/AccessControl.sol)

pragma solidity ^0.8.0;

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
contract AccessControlMechanism is AccessControl {
    // Mechanism to implement propose and claim Access control Roles 
    // grantRole, revokeRole can be used to grant and revoke roles directly
    
    bytes32 public constant FEE_ROLE = keccak256("FEE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant IMPLEMENTER_ROLE = keccak256("IMPLEMENTATER_ROLE");

    mapping(bytes32 => mapping(address => bool)) public pendingRoles;


    constructor (address _admin) {
        bytes32 _defaultAdminRole = DEFAULT_ADMIN_ROLE;
        _grantRole(_defaultAdminRole, _admin);
        _setRoleAdmin(_defaultAdminRole, _defaultAdminRole);
        _setRoleAdmin(FEE_ROLE, _defaultAdminRole);
        _setRoleAdmin(PAUSER_ROLE, _defaultAdminRole);
        _setRoleAdmin(IMPLEMENTER_ROLE, _defaultAdminRole);
    }

    // Set role admin can only be called by admin of that role
    function setRoleAdmin(bytes32 _role, bytes32 _adminRole) external onlyRole(getRoleAdmin(_role)) {
        _setRoleAdmin(_role, _adminRole);
    }

    // propose a user for a role
    function proposeGrantRole(bytes32 _role, address _to) external onlyRole(getRoleAdmin(_role)) {
        pendingRoles[_role][_to] = true;
    }

    // user needs to claim proposed role
    function claimRole(bytes32 _role) external {
        require(pendingRoles[_role][msg.sender], "AccessControl: Role not pending");
        _grantRole(_role, msg.sender);
        delete pendingRoles[_role][msg.sender];
    }


}