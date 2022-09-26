// SPDX-License-Identifier: GPL-3.0
pragma solidity 0.8.10;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";


contract ERC721TestToken is ERC721("NFT", "NFT"){

    function mint(address to, uint tokenID) public {
        _mint(to, tokenID);   
    }

}