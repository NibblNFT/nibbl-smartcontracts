// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";

interface IBasket is IERC721, IERC721Receiver, IERC1155Receiver {

    function initialise(address _curator) external;
    function withdrawERC721(address _token, uint256 _tokenId, address _to) external;
    function withdrawMultipleERC721(address[] memory _tokens, uint256[] memory _tokenId, address _to) external;
    function withdrawERC721Unsafe(address _token, uint256 _tokenId, address _to) external;
    function withdrawERC1155(address _token, uint256 _tokenId, address _to) external;
    function withdrawMultipleERC1155(address[] memory _tokens, uint256[] memory _tokenIds, address _to) external;
    function withdrawETH(address payable _to) external;
    function withdrawERC20(address _token) external;
    function withdrawMultipleERC20(address[] memory _tokens) external;
    
}