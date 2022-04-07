// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import { INibblVault } from "../../Interfaces/INibblVault.sol";
import "hardhat/console.sol";

contract Reenterer {
    
    fallback() external {
        INibblVault(msg.sender).buy{value: 0}(0, payable(msg.sender));
    }

}