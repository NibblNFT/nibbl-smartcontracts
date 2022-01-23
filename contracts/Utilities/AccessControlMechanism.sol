import { AccessControl } from "@openzeppelin/contracts/access/AccessControl.sol";


contract AccessControlMechanism is AccessControl {
    bytes32 public constant FEE_ROLE = keccak256("FEE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant IMPLEMENTER_ROLE = keccak256("IMPLEMENTATER_ROLE");
}