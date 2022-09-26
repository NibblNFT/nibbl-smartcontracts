


// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.10;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";


contract ERC20TestToken is ERC20("ERC20Token", "ERC20Token"){
    function mint(address to, uint256 amount) public {
        _mint(to, amount);   
    }

}