// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { BancorBondingCurve } from "./Bancor/BancorBondingCurve.sol";
import { IERC721Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721Upgradeable.sol";
import { IERC721ReceiverUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import { SafeMathUpgradeable } from  "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import { IERC721ReceiverUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import { NibblVaultFactory } from "./NibblVaultFactory.sol";
import "hardhat/console.sol";


contract NibblVault is BancorBondingCurve, ERC20Upgradeable, IERC721ReceiverUpgradeable {
    
    /*
    InitialTokenPrice = 10^-3
    scale = 1000000
    */
    address public factory;
    address public curator;
    address public assetAddress;
    uint256 public assetID;
    uint256 private constant SCALE = 1_000_000;


    uint256 public constant primaryReserveRatio = 500_000; //50%
    uint256 public constant rejectionPremium = 100_000; //10%
    uint256 public secondaryReserveRatio;

    uint256 public initialTokenSupply;

    uint256 public primaryReserveBalance;
    uint256 public secondaryReserveBalance;
    
    uint256 public feeAccruedCurator;

    uint256 private constant INITIAL_TOKEN_PRICE = 1e14; //10^-4

    enum Status {initialised, buyout, buyoutCompleted}

    Status public status;

    function initialize(
        string memory _tokenName, 
        string memory _tokenSymbol, 
        address _assetAddress,
        uint256 _assetID,
        address _curator,
        uint256 _initialTokenSupply
    ) public initializer payable {
        __ERC20_init(_tokenName, _tokenSymbol);
        factory = msg.sender;
        assetAddress = _assetAddress;
        assetID = _assetID;
        curator = _curator;
        initialTokenSupply = _initialTokenSupply;
        primaryReserveBalance = (primaryReserveRatio * initialTokenSupply * INITIAL_TOKEN_PRICE) / (SCALE * 1e18);
        secondaryReserveBalance = msg.value;
        secondaryReserveRatio = (msg.value * SCALE * 1e18) / (_initialTokenSupply * INITIAL_TOKEN_PRICE);
        _mint(_curator, _initialTokenSupply);
    }

    function _chargeFee(uint256 _amount) private returns(uint256){
        (address _adminFeeTo, uint256 _adminFeeAmt) = NibblVaultFactory(factory).getFee();
        (uint256 _curatorFeeAmt, uint256 _curveFeeAmt) = getCurveFee();

        uint256 _feeAdmin = (_amount * _adminFeeAmt) / SCALE ;
        uint256 _feeCurator = (_amount * _curatorFeeAmt) / SCALE ;
        uint256 _feeCurve = (_amount * _curveFeeAmt) / SCALE ;

        if(_adminFeeAmt > 0) {
            (bool success, ) = payable(_adminFeeTo).call{value: _feeAdmin}("");
            require(success, "NibblVault: Failed to charge admin fee");
        }

        feeAccruedCurator += _feeCurator;
        secondaryReserveBalance += _feeCurve;
        secondaryReserveRatio = (secondaryReserveBalance * SCALE * 1e18) / (initialTokenSupply * INITIAL_TOKEN_PRICE);
        return _amount - (_feeAdmin + _feeCurator + _feeCurve);
    }


    function getMaxSecondaryCurveBalance() private view returns(uint256){
            return ((secondaryReserveRatio * initialTokenSupply * INITIAL_TOKEN_PRICE) / (1e18 * SCALE));
    }

    function getCurveFee() private view returns (uint256, uint256)/**curator, curve  */ {
        if (secondaryReserveRatio < primaryReserveRatio) {
            return (4000, 4000); //.4%, .4%
        } else {
            return (8000, 0); //.8%, 0%
        }
    }

    function _buyPrimaryCurve(address _to, uint256 _amount) private returns (uint256 _purchaseReturn) {
        uint256 _amountIn = _chargeFee(_amount);
        _purchaseReturn = _calculatePurchaseReturn(totalSupply(), primaryReserveBalance, uint32(primaryReserveRatio), _amountIn);
        primaryReserveBalance += _amountIn;
        _mint(_to, _purchaseReturn);
    }

    function _buySecondaryCurve(address _to, uint256 _amount) private returns (uint256 _purchaseReturn) {
        _purchaseReturn = _calculatePurchaseReturn(totalSupply(), secondaryReserveBalance, uint32(secondaryReserveRatio), _amount);
        secondaryReserveBalance += _amount;
        _mint(_to, _purchaseReturn);
    }

    function buy(uint256 _minAmtOut, address _to) external payable {
        require(_to != address(0), " NibblVault: Zero address");
        uint256 _purchaseReturn;
        if (totalSupply() >= initialTokenSupply) { 
            _purchaseReturn += _buyPrimaryCurve(_to, msg.value);
        } else {
            uint256 _lowerCurveDiff = getMaxSecondaryCurveBalance() - secondaryReserveBalance;
            if (_lowerCurveDiff >= msg.value) {
                _purchaseReturn += _buySecondaryCurve(_to, msg.value);
            } else {
                _purchaseReturn += _buySecondaryCurve(_to, _lowerCurveDiff);
                _purchaseReturn += _buyPrimaryCurve(_to, msg.value - _lowerCurveDiff);
            } 
        }
        require(_minAmtOut <= _purchaseReturn, "NibblVault: Insufficient amount out");
    }

    function _sellPrimaryCurve(uint256 _amount) private returns(uint256 _saleReturn) {
        _saleReturn = _calculateSaleReturn(totalSupply(), primaryReserveBalance, uint32(primaryReserveRatio), _amount);
        primaryReserveBalance -= _saleReturn;
        _burn(msg.sender, _amount);
        _saleReturn = _chargeFee(_saleReturn);
    }

    function _sellSecondaryCurve(uint256 _amount) private returns(uint256 _saleReturn){
        _saleReturn = _calculateSaleReturn(totalSupply(), secondaryReserveBalance, uint32(secondaryReserveRatio), _amount);
        _burn(msg.sender, _amount);
        secondaryReserveBalance -= _saleReturn;
    }

    function sell(uint256 _amtIn, uint256 _minAmtOut, address _to) external payable {
        require(_to != address(0), "NibblVault: Invalid address");
        uint256 _saleReturn;
        if(totalSupply() > initialTokenSupply) {
            if ((initialTokenSupply + _amtIn) <= totalSupply()) {
                _saleReturn += _sellPrimaryCurve(_amtIn);
            } else {
                uint256 _tokensPrimaryCurve = totalSupply() - initialTokenSupply;
                _saleReturn += _sellPrimaryCurve(_tokensPrimaryCurve);
                _saleReturn += _sellSecondaryCurve(_amtIn - _tokensPrimaryCurve);
            } } else {
                _saleReturn += _sellSecondaryCurve(_amtIn);
        }
        require(_saleReturn >= _minAmtOut, "NibblVault: Insufficient amount out");
        (bool success, ) = payable(_to).call{value: _saleReturn}("");
        require(success, "NibblVault: Failed to send funds");
    }



    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }
}