// SPDX-License-Identifier: BUSL-1.1

pragma solidity 0.8.10;

import { INibblVault } from "../../Interfaces/INibblVault.sol";

contract Reenterer {
    
    fallback() external {
        INibblVault(msg.sender).buy{value: 0}(0, payable(msg.sender));
    }

}