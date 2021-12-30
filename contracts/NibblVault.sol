// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { BancorBondingCurve } from "./Bancor/BancorBondingCurve.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { SafeMathUpgradeable } from  "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
import { IERC721ReceiverUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC721/IERC721ReceiverUpgradeable.sol";
import { NibblVaultFactory } from "./NibblVaultFactory.sol";
import { Twav } from "./Twav/Twav.sol";

import "hardhat/console.sol";


contract NibblVault is BancorBondingCurve, ERC20Upgradeable, IERC721ReceiverUpgradeable, Twav {
    
    /*
    InitialTokenPrice = 10^-3
    scale = 1000000
    */
    uint32 private constant primaryReserveRatio = 500_000; //50%
    uint32 public secondaryReserveRatio;

    //0 1 2 3 4 5 6 7 8 9 10 11 
    address public factory;
    address public curator;
    address public assetAddress;
    address public bidder;
    
    uint256 public assetID;
    uint256 private constant SCALE = 1_000_000;
    uint256 private constant REJECTION_PREMIUM = 100_000; //10%
    uint256 private constant BUYOUT_DURATION = 3 days; 
    uint256 public INITIAL_TOKEN_PRICE; //10^-4
    uint256 private fictitiousPrimaryReserveBalance;

    uint256 public buyoutRejectionValuation; //valuation at which buyout is supposed to be rejected 
    uint256 public buyoutValuationDeposit; //Deposit made by bidder to initiate buyout msg.value in initiateBuyout Method
    //TODO: Fee admin variable and function to update it
    uint256 public initialTokenSupply;
    uint256 public primaryReserveBalance;
    uint256 public secondaryReserveBalance;
    uint256 public feeAccruedCurator;
    uint256 public buyoutEndTime;
    uint256 public buyoutBid; //Valuation at whoch buyout happens
    uint256 private unlocked = 1;


    enum Status {initialised, buyout}

    Status public status;

    //TODO: Change modifiers to initialised, buyout, buyoutCompleted

    modifier notBoughtOut() {
        //For the case when buyoutTime has ended and buyout has not been rejected
        require(buyoutEndTime > block.timestamp || buyoutEndTime == 0,'NFT has been bought');
        _;
    }

    modifier boughtOut() {
        require(status == Status.buyout);
        require(buyoutEndTime < block.timestamp);
        _;
    }

    modifier lock() {
        require(unlocked == 1, 'NibblVault: Locked');
        unlocked = 0;
        _;
        unlocked = 1;
    }

    function initialize(
        string memory _tokenName, 
        string memory _tokenSymbol, 
        address _assetAddress,
        uint256 _assetID,
        address _curator,
        uint256 _initialTokenSupply,
        uint256 _initialTokenPrice
    ) public initializer payable {
        __ERC20_init(_tokenName, _tokenSymbol);
        INITIAL_TOKEN_PRICE=_initialTokenPrice;
        factory = msg.sender;
        assetAddress = _assetAddress;
        assetID = _assetID;
        curator = _curator;
        initialTokenSupply = _initialTokenSupply;
        primaryReserveBalance = (primaryReserveRatio * initialTokenSupply * INITIAL_TOKEN_PRICE) / (SCALE * 1e18);
        fictitiousPrimaryReserveBalance = primaryReserveBalance; //TODO: GAS IMPROVISATION
        secondaryReserveBalance = msg.value;
        secondaryReserveRatio = uint32((msg.value * SCALE * 1e18) / (_initialTokenSupply * INITIAL_TOKEN_PRICE));
        require(secondaryReserveRatio <= primaryReserveRatio, "NibblVault: Excess initial funds"); //secResratio <= PrimaryResRatio
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
        secondaryReserveRatio = uint32((secondaryReserveBalance * SCALE * 1e18) / (initialTokenSupply * INITIAL_TOKEN_PRICE));
        return _amount - (_feeAdmin + _feeCurator + _feeCurve);
    }


    function getMaxSecondaryCurveBalance() private view returns(uint256){
            return ((secondaryReserveRatio * initialTokenSupply * INITIAL_TOKEN_PRICE) / (1e18 * SCALE));
    }

    function getCurrentValuation() private view returns(uint256){
            return (secondaryReserveBalance * SCALE /secondaryReserveRatio) + ((primaryReserveBalance - fictitiousPrimaryReserveBalance) * SCALE  /primaryReserveRatio);
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
        _purchaseReturn = _calculatePurchaseReturn(totalSupply(), primaryReserveBalance, primaryReserveRatio, _amountIn);
        primaryReserveBalance += _amountIn;
        _mint(_to, _purchaseReturn);
    }
 
    function _buySecondaryCurve(address _to, uint256 _amount) private returns (uint256 _purchaseReturn) {
        _purchaseReturn = _calculatePurchaseReturn(totalSupply(), secondaryReserveBalance, secondaryReserveRatio, _amount);
        secondaryReserveBalance += _amount;
        _mint(_to, _purchaseReturn);
    }

    function buy(uint256 _minAmtOut, address _to) external payable notBoughtOut {
        require(_to != address(0), " NibblVault: Zero address");
        //Make update on the first tx of the block
        uint32 _blockTimestamp = uint32(block.timestamp % 2**32);
        if (_blockTimestamp != lastBlockTimeStamp) {
            _updateTWAV(getCurrentValuation(), _blockTimestamp);   
        }
        uint256 _purchaseReturn;
        if (totalSupply() >= initialTokenSupply) { 
            _purchaseReturn = _buyPrimaryCurve(_to, msg.value);
        } else {
            uint256 _lowerCurveDiff = getMaxSecondaryCurveBalance() - secondaryReserveBalance;
            if (_lowerCurveDiff >= msg.value) {
                _purchaseReturn = _buySecondaryCurve(_to, msg.value);
            } else {
                _purchaseReturn = _buySecondaryCurve(_to, _lowerCurveDiff);
                _purchaseReturn += _buyPrimaryCurve(_to, msg.value - _lowerCurveDiff);
            } 
        }
        require(_minAmtOut <= _purchaseReturn, "NibblVault: Insufficient amount out");
        if (status == Status.buyout) {
            _rejectBuyout();
        }
    }

    function _sellPrimaryCurve(uint256 _amount) private returns(uint256 _saleReturn) {
        _saleReturn = _calculateSaleReturn(totalSupply(), primaryReserveBalance, primaryReserveRatio, _amount);
        primaryReserveBalance -= _saleReturn;
        _burn(msg.sender, _amount);
        _saleReturn = _chargeFee(_saleReturn);
    }

    function _sellSecondaryCurve(uint256 _amount) private returns(uint256 _saleReturn){
        _saleReturn = _calculateSaleReturn(totalSupply(), secondaryReserveBalance, secondaryReserveRatio, _amount);
        secondaryReserveBalance -= _saleReturn;
        _burn(msg.sender, _amount);
    }

    function sell(uint256 _amtIn, uint256 _minAmtOut, address _to) external payable notBoughtOut lock {
        require(_to != address(0), "NibblVault: Invalid address");
        //Make update on the first tx of the block
        uint32 _blockTimestamp = uint32(block.timestamp % 2**32);
        if (_blockTimestamp != lastBlockTimeStamp) {
            _updateTWAV(getCurrentValuation(), _blockTimestamp);   
        }
        
        uint256 _saleReturn;
        if(totalSupply() > initialTokenSupply) {
            if ((initialTokenSupply + _amtIn) <= totalSupply()) {
                _saleReturn = _sellPrimaryCurve(_amtIn);
            } else {
                uint256 _tokensPrimaryCurve = totalSupply() - initialTokenSupply;
                _saleReturn = _sellPrimaryCurve(_tokensPrimaryCurve);
                _saleReturn += _sellSecondaryCurve(_amtIn - _tokensPrimaryCurve);
            } } else {
                _saleReturn = _sellSecondaryCurve(_amtIn);
        }
        require(_saleReturn >= _minAmtOut, "NibblVault: Insufficient amount out");
        (bool _success, ) = payable(_to).call{value: _saleReturn}("");
        require(_success, "NibblVault: Failed to send funds");
    }

    function initiateBuyOut() public payable {
        //TODO: add bid placer
        require(status == Status.initialised, "NibblVault: Only when initialised");
        uint256 _buyoutBid = msg.value + (primaryReserveBalance - fictitiousPrimaryReserveBalance) + secondaryReserveBalance;
        require(_buyoutBid >= getCurrentValuation(), "NibblVault: Low buyout valuation");
        bidder = msg.sender;
        buyoutValuationDeposit = msg.value;
        buyoutRejectionValuation = (_buyoutBid * (SCALE + REJECTION_PREMIUM)) / SCALE;
        buyoutEndTime = block.timestamp + BUYOUT_DURATION;
        buyoutBid = _buyoutBid;
        status = Status.buyout;
    }

    function _rejectBuyout() internal notBoughtOut {
        uint256 _twav = _getTwav();
        if (_twav >= buyoutRejectionValuation) {
            delete buyoutRejectionValuation;
            delete buyoutEndTime;
            status = Status.initialised;
            (bool _success,) = payable(bidder).call{value: buyoutValuationDeposit}("");
            require(_success);
        }
    }

    function redeem() public boughtOut {
        uint256 _balance = balanceOf(msg.sender);
        uint256 redeemableBalance = address(this).balance-feeAccruedCurator;

        uint256 _amtOut = (redeemableBalance * _balance) / totalSupply();
        _burn(msg.sender, _balance);
        (bool _success,) = payable(msg.sender).call{value: _amtOut}("");
        require(_success);
    }

    function unlockNFT(address _to) public boughtOut {
        require(msg.sender==bidder,"NibblVault: Only winner can unlock");
        IERC721(assetAddress).transferFrom(address(this), _to, assetID);
    }
    
    function redeemCuratorFee(address _to) public {
        require(msg.sender==curator,"NibblVault: Only Curator can redeem");
        (bool _success,) = payable(_to).call{value: feeAccruedCurator}("");
        feeAccruedCurator = 0;
        require(_success);
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