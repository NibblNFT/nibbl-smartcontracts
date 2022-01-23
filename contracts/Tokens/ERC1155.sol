// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.4;

import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";


contract ERC1155Token is ERC1155(""){
    function mint(address to, uint tokenID, uint256 amount) public {
        _mint(to, tokenID, amount, "");   
    }

    // function safeTransferFrom(
    //     address from,
    //     address to,
    //     uint256 id,
    //     uint256 amount
    // ) public {
    //     safeTransferFrom( from, to, id, amount, "0x00");
    // }
}