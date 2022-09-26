// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import { ERC1155SupplyUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC1155/extensions/ERC1155SupplyUpgradeable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "hardhat/console.sol";
contract ERC1155Link is ERC1155SupplyUpgradeable {

    uint256 public mintRatio; // Number of ERC20s required for each ERC1155 token[0]

    IERC20 public linkErc20;
    constructor () {
        _disableInitializers();
    }

    function initialize(string memory _uri, uint256 _mintRatio) external initializer {
        mintRatio = _mintRatio;
        linkErc20 = IERC20(msg.sender);
        __ERC1155_init(_uri);
    }

    function wrap(address _to, uint256 _amount) external {
        linkErc20.transferFrom(msg.sender, address(this), _amount * mintRatio);
        _mint(_to, 0, _amount, "0");
    }

    function unwrap(address _to, uint256 _amount) external {
        _burn(msg.sender, 0, _amount);
        linkErc20.transfer(_to, _amount * mintRatio);
        
    }

}

