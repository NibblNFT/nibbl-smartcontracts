// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.10;

import { ERC1155 } from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";


contract ERC1155TestToken is ERC1155(""){
    function mint(address to, uint tokenID, uint256 amount) public {
        _mint(to, tokenID, amount, "");   
    }

    function mintBatch(
        address to,
        uint256[] memory ids,
        uint256[] memory amounts
    ) public {
        _mintBatch(to, ids, amounts, "");
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