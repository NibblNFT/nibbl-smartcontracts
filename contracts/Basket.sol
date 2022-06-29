// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.10;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { ERC721, IERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { IERC165, ERC165 } from "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import { IBasket } from "./Interfaces/IBasket.sol";
import { Initializable } from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
/**
 * Mint a single ERC721 which can hold NFTs
 */
contract Basket is IBasket, ERC721("NFT Basket", "NFTB"), Initializable {

    using SafeERC20 for IERC20;

    event DepositERC721(address indexed token, uint256 tokenId, address indexed from);
    event WithdrawERC721(address indexed token, uint256 tokenId, address indexed to);
    event DepositERC1155(address indexed token, uint256 tokenId, uint256 amount, address indexed from);
    event DepositERC1155Bulk(address indexed token, uint256[] tokenId, uint256[] amount, address indexed from);
    event WithdrawERC1155(address indexed token, uint256 tokenId, uint256 amount, address indexed from);
    event WithdrawETH(address indexed who);
    event WithdrawERC20(address indexed token, address indexed who);

    function initialise(address _curator) external override initializer {
        _mint(_curator, 0);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, IERC165) returns (bool) {
        return
            super.supportsInterface(interfaceId) || interfaceId == type(IBasket).interfaceId;
    }

    /// @notice withdraw an ERC721 token from this contract into your wallet
    /// @param _token the address of the NFT you are withdrawing
    /// @param _tokenId the ID of the NFT you are withdrawing
    function withdrawERC721(address _token, uint256 _tokenId, address _to) external override {
        require(_isApprovedOrOwner(msg.sender, 0), "withdraw:not allowed");
        IERC721(_token).safeTransferFrom(address(this), _to, _tokenId);
        emit WithdrawERC721(_token, _tokenId, _to);
    }

    function withdrawMultipleERC721(address[] calldata _tokens, uint256[] calldata _tokenId, address _to) external override {
        require(_isApprovedOrOwner(msg.sender, 0), "withdraw:not allowed");
        uint256 _length = _tokens.length;
        for (uint256 i; i < _length; ++i) {
            IERC721(_tokens[i]).safeTransferFrom(address(this), _to, _tokenId[i]);
            emit WithdrawERC721(_tokens[i], _tokenId[i], _to);
        }
    }
    
    /// @notice withdraw an ERC721 token from this contract into your wallet
    /// @param _token the address of the NFT you are withdrawing
    /// @param _tokenId the ID of the NFT you are withdrawing
    function withdrawERC721Unsafe(address _token, uint256 _tokenId, address _to) external override {
        require(_isApprovedOrOwner(msg.sender, 0), "withdraw:not allowed");
        IERC721(_token).transferFrom(address(this), _to, _tokenId);
        emit WithdrawERC721(_token, _tokenId, _to);
    }
    
    /// @notice withdraw an ERC721 token from this contract into your wallet
    /// @param _token the address of the NFT you are withdrawing
    /// @param _tokenId the ID of the NFT you are withdrawing
    function withdrawERC1155(address _token, uint256 _tokenId, address _to) external override {
        require(_isApprovedOrOwner(msg.sender, 0), "withdraw:not allowed");
        uint256 _balance = IERC1155(_token).balanceOf(address(this),  _tokenId);
        IERC1155(_token).safeTransferFrom(address(this), _to, _tokenId, _balance, "0");
        emit WithdrawERC1155(_token, _tokenId, _balance, _to);
    }

    function withdrawMultipleERC1155(address[] calldata _tokens, uint256[] calldata _tokenIds, address _to) external override {
        require(_isApprovedOrOwner(msg.sender, 0), "withdraw:not allowed");
        uint256 _length = _tokens.length;
        for (uint256 i; i < _length; ++i) {
            uint256 _balance = IERC1155(_tokens[i]).balanceOf(address(this),  _tokenIds[i]);
            IERC1155(_tokens[i]).safeTransferFrom(address(this), _to, _tokenIds[i], _balance, "0");
            emit WithdrawERC1155(_tokens[i], _tokenIds[i], _balance, _to);
        }
    }

    /// @notice withdraw ETH in the case a held NFT earned ETH (ie. euler beats)
    function withdrawETH(address payable _to) external override {
        require(_isApprovedOrOwner(msg.sender, 0), "withdraw:not allowed");
        _to.transfer(address(this).balance);
        emit WithdrawETH(_to);
    }

    /// @notice withdraw ERC20 in the case a held NFT earned ERC20
    function withdrawERC20(address _token) external override {
        require(_isApprovedOrOwner(msg.sender, 0), "withdraw:not allowed");
        IERC20(_token).safeTransfer(msg.sender, IERC20(_token).balanceOf(address(this)));
        emit WithdrawERC20(_token, msg.sender);
    }

    function withdrawMultipleERC20(address[] calldata _tokens) external override {
        require(_isApprovedOrOwner(msg.sender, 0), "withdraw:not allowed");
        uint256 _length = _tokens.length;
        for (uint256 i; i < _length; ++i) {
            IERC20(_tokens[i]).safeTransfer(msg.sender, IERC20(_tokens[i]).balanceOf(address(this)));
            emit WithdrawERC20(_tokens[i], msg.sender);
        }
    }

    function onERC721Received(address, address from, uint256 id, bytes memory) external override returns(bytes4) {
        emit DepositERC721(msg.sender, id, from);
        return this.onERC721Received.selector;
    }

    function onERC1155Received(address, address from, uint256 id, uint256 amount, bytes memory) external virtual override returns (bytes4) {
        emit DepositERC1155(msg.sender, id, amount, from);
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address from, uint256[] calldata ids, uint256[] calldata amounts, bytes memory) external virtual override returns (bytes4) {
        emit DepositERC1155Bulk(msg.sender, ids, amounts, from);
        return this.onERC1155BatchReceived.selector;
    }
    
    receive() external payable {}
}