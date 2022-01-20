


// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract ERC20Token is ERC20("", ""){
    function mint(address to, uint256 amount) public {
        _mint(to, amount);   
    }

}