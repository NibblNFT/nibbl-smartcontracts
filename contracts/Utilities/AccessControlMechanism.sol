// SPDX-License-Identifier: BUSL-1.1
// OpenZeppelin Contracts v4.4.1 (access/AccessControl.sol)

pragma solidity 0.8.10;
import { IAccessControlMechanism } from "../Interfaces/IAccessControlMechanism.sol";

import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";
contract AccessControlMechanism is IAccessControlMechanism, AccessControl {
    // Mechanism to implement propose and claim Access control Roles 
    // grantRole, revokeRole can be used to grant and revoke roles directly
    
    bytes32 public constant FEE_ROLE = keccak256("FEE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant IMPLEMENTER_ROLE = keccak256("IMPLEMENTER_ROLE");

    mapping(bytes32 => mapping(address => bool)) public pendingRoles;


    constructor (address _admin) {
        bytes32 _defaultAdminRole = DEFAULT_ADMIN_ROLE;
        _grantRole(_defaultAdminRole, _admin);
        _setRoleAdmin(_defaultAdminRole, _defaultAdminRole);
        _setRoleAdmin(FEE_ROLE, _defaultAdminRole);
        _setRoleAdmin(PAUSER_ROLE, _defaultAdminRole);
        _setRoleAdmin(IMPLEMENTER_ROLE, _defaultAdminRole);
    }

    /// @notice sets admin role for a role
    /// @dev can only be called adminRole of _role
    /// @param _role roles whose admin needs to be updated
    /// @param _adminRole new admin role
    function setRoleAdmin(bytes32 _role, bytes32 _adminRole) external override onlyRole(getRoleAdmin(_role)) {
        _setRoleAdmin(_role, _adminRole);
    }

    /// @notice proposes a user for a role
    /// @dev can only be called by admin of that role
    /// @param _role _role to which the user is proposed
    /// @param _to user proposed
    function proposeGrantRole(bytes32 _role, address _to) external override onlyRole(getRoleAdmin(_role)) {
        pendingRoles[_role][_to] = true;
    }

    /// @notice proposed user needs to claim the role
    /// @dev can only be called by the proposed user
    /// @param _role role to be claimed
    function claimRole(bytes32 _role) external override {
        require(pendingRoles[_role][msg.sender], "AccessControl: Role not pending");
        _grantRole(_role, msg.sender);
        delete pendingRoles[_role][msg.sender];
    }


}