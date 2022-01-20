// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { BancorBondingCurve } from "./Bancor/BancorBondingCurve.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeMathUpgradeable } from  "@openzeppelin/contracts-upgradeable/utils/math/SafeMathUpgradeable.sol";
// import { IERC721Receiver } from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
// import { IERC1155Receiver } from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import { NibblVaultFactory } from "./NibblVaultFactory.sol";
import { Twav } from "./Twav/Twav.sol";

import "hardhat/console.sol";


contract NibblVault is BancorBondingCurve, ERC20Upgradeable, Twav {
    // scale = 10^6
    uint256 private constant SCALE = 1_000_000_000;

    // primary reserve ratio = 50%
    uint32 private constant primaryReserveRatio = 500_000_000;
    
    // premium above the buyout bid that the bonding curve valuation needs to go to for buyout to get rejected
    uint256 private constant REJECTION_PREMIUM = 100_000_000;

    // time till buyout rejection can happen, otherwise buyout succeeds
    uint256 private constant BUYOUT_DURATION = 3 days; 

    uint256 private constant CURVE_FEE_AMT = 4_000_000; 

    uint32 public secondaryReserveRatio;

    /// @notice address of the Nibbl factory contract
    address public factory;

    /// @notice address of the original NFT owner
    address public curator;

    /// @notice token address of the NFT being deposited in the vault
    address public assetAddress;

    /// @notice token ID of the NFT being deposited in the vault
    uint256 public assetID;

    /// @notice address which triggered the buyout
    address public bidder;


    /// @notice initial price of the fractional ERC20 Token set by the curator
    uint256 public initialTokenPrice;

    uint256 private fictitiousPrimaryReserveBalance;

    /// @notice the valuation at which the buyout is rejected
    uint256 public buyoutRejectionValuation;
    
    /// @notice deposit made by bidder to initiate buyout
    uint256 public buyoutValuationDeposit;
    
    /// @notice initial token supply
    uint256 public initialTokenSupply;
    
    /// @notice reserve balance of the primary/upper curve
    uint256 public primaryReserveBalance;
    
    /// @notice reserve balance of the secondary/lower curve
    uint256 public secondaryReserveBalance;
    
    /// @notice total fee accrued by the curator
    uint256 public feeAccruedCurator;
    
    /// @notice the time at which the buyout ends
    uint256 public buyoutEndTime;
    
    /// @notice valuation at which buyout was triggered
    uint256 public buyoutBid;

    /// @notice percentage of transaction fee that goes to the curator
    uint256 public curatorFee;

    uint256 public totalUnsettledBids;

    bool private entered = false;

    mapping(address => uint256) public unsettledBids;

    enum Status {initialised, buyout}

    Status public status;

    event BuyoutInitiated(address indexed bidder, uint256 indexed bid);
    event BuyoutRejected();
    event CuratorFeeUpdated(uint256 indexed fee);

    modifier notBoughtOut() {
        //For the case when buyoutTime has ended and buyout has not been rejected
        require(buyoutEndTime > block.timestamp || buyoutEndTime == 0,'NFT has been bought');
        _;
    }

    modifier boughtOut() {
        require(status == Status.buyout, "NFT has not been bought");
        require(buyoutEndTime <= block.timestamp);
        _;
    }

    modifier lock() {
        require(!entered, 'NibblVault: Locked');
        entered = true;
        _;
        entered = false;
    }

    /// @notice the function to initialise vault parameters
    /// @param _tokenName name of the fractional ERC20 token to be created
    /// @param _tokenSymbol symbol fo the fractional ERC20 token
    /// @param _assetAddress address of the NFT contract which is being fractionalised
    /// @param _assetID tokenId of the NFT being fractionalised
    /// @param _initialTokenSupply desired initial supply
    /// @param _initialTokenPrice desired initial token price
    /// @param _curatorFee fee percentage for curator
    /// @dev reserveBalance = valuation * reserveRatio
    /// @dev valuation = price * supply
    function initialize(
        string memory _tokenName, 
        string memory _tokenSymbol, 
        address _assetAddress,
        uint256 _assetID,
        address _curator,
        uint256 _initialTokenSupply,
        uint256 _initialTokenPrice,
        uint256 _curatorFee
    ) public initializer payable {
        require(_curatorFee <= MAX_CURATOR_FEE(),"NibblVault: Curator fee should not be more than 1 %");
        __ERC20_init(_tokenName, _tokenSymbol);
        curatorFee = _curatorFee;
        initialTokenPrice=_initialTokenPrice;
        factory = msg.sender;
        assetAddress = _assetAddress;
        assetID = _assetID;
        curator = _curator;
        initialTokenSupply = _initialTokenSupply;
        uint _primaryReserveBalance = (primaryReserveRatio * initialTokenSupply * initialTokenPrice) / (SCALE * 1e18);
        primaryReserveBalance = _primaryReserveBalance;
        fictitiousPrimaryReserveBalance = _primaryReserveBalance;
        secondaryReserveBalance = msg.value;
        uint32 _secondaryReserveRatio = uint32((msg.value * SCALE * 1e18) / (_initialTokenSupply * initialTokenPrice));
        secondaryReserveRatio = _secondaryReserveRatio;
        require(_secondaryReserveRatio <= primaryReserveRatio, "NibblVault: Excess initial funds"); //secResratio <= PrimaryResRatio
        require(_secondaryReserveRatio >= 1_000_000, "NibblVault: SecondaryReserveRatio too low");
        _mint(_curator, _initialTokenSupply);
    }

    /// @notice Function which charges fees on buying and selling
    /// @dev There are 3 types of fee charged (all in wei) - admin, curator and curve
    ///      Admin fee amount is fetched from the factory contract and the fee charged is transferred to admin address
    ///      Curator fee is fetched from vault contract and is stored in feeAccruedCurator 
    ///      Curve fee is also fetched from the vault contract and is added to the secondary reserve balance
    /// @param _amount buy/sell trade amount in wei
    function _chargeFee(uint256 _amount) private returns(uint256){
        address payable _factory = payable(factory);
        uint256 _adminFeeAmt = NibblVaultFactory(_factory).feeAdmin();
        uint256 _curatorFeeAmt = curatorFee;
        uint256 _feeAdmin = (_amount * _adminFeeAmt) / SCALE ;
        uint256 _feeCurator = (_amount * _curatorFeeAmt) / SCALE ;
        uint256 _feeCurve = (_amount * CURVE_FEE_AMT) / SCALE ;
        if(_adminFeeAmt > 0) {
            (bool success, ) = _factory.call{value: _feeAdmin}("");
            require(success, "NibblVault: Failed to charge admin fee");
        }
        feeAccruedCurator += _feeCurator;
        uint256 _maxSecondaryBalanceIncrease = fictitiousPrimaryReserveBalance - secondaryReserveBalance;
        secondaryReserveBalance += _maxSecondaryBalanceIncrease > _feeCurve ? _feeCurve : _maxSecondaryBalanceIncrease;
        secondaryReserveRatio = uint32((secondaryReserveBalance * SCALE * 1e18) / (initialTokenSupply * initialTokenPrice));
        return _amount - (_feeAdmin + _feeCurator + _feeCurve);
    }

    /// @dev Amount of reserve balance in secondary curve if curve went from origin to initial fractionalization point
    function getMaxSecondaryCurveBalance() private view returns(uint256){
            return ((secondaryReserveRatio * initialTokenSupply * initialTokenPrice) / (1e18 * SCALE));
    }

    /// @dev Sums valuation on secondary curve and primary curve
    ///      Real reserve balance in primary curve = primaryReserveBalance - fictitiousPrimaryReserveBalance
    /// @return Current valuation in bonding curve
    function getCurrentValuation() private view returns(uint256){
            return totalSupply() < initialTokenSupply ? (secondaryReserveBalance * SCALE /secondaryReserveRatio) : ((primaryReserveBalance) * SCALE  / primaryReserveRatio);
    }

    // /// @dev Curve fee is non-zero only till secondary reserve ratio has not become equal to primary reserve ratio
    // /// @return Curator and curve fee respectively
    // function getCurveFee() private view returns (uint256, uint256)/**curator, curve  */ {
    //     if (secondaryReserveRatio < primaryReserveRatio) {
    //         return (curatorFee, 4000);
    //     } else {
    //         return (curatorFee, 0);
    //     }
    // }

    /// @dev Possible maximum curator fee is less till the point secondary reserve ratio has not become equal to primary reserve ratio
    /// @return Maximum curator fee possible
    function MAX_CURATOR_FEE() view private returns (uint256) {
        if (secondaryReserveRatio < primaryReserveRatio) {
            return 5_000_000;
        } else {
            return 10_000_000;
        }            
    }

    /// @dev This is executed when current supply>=initial supply
    /// @param _to Address to send the bought tokens to
    /// @param _amount Amount in wei deposited for buying
    /// @return _purchaseReturn Purchase return
    function _buyPrimaryCurve(address _to, uint256 _amount) private returns (uint256 _purchaseReturn) {
        uint256 _amountIn = _chargeFee(_amount);
        _purchaseReturn = _calculatePurchaseReturn(totalSupply(), primaryReserveBalance, primaryReserveRatio, _amountIn);
        primaryReserveBalance += _amountIn;
        _mint(_to, _purchaseReturn);
    }

    /// @dev This is executed when current supply<initial supply
    /// @param _to Address to send the bought tokens to
    /// @param _amount Amount in wei deposited for buying
    /// @return _purchaseReturn Purchase return
    function _buySecondaryCurve(address _to, uint256 _amount) private returns (uint256 _purchaseReturn) {
        _purchaseReturn = _calculatePurchaseReturn(totalSupply(), secondaryReserveBalance, secondaryReserveRatio, _amount);
        secondaryReserveBalance += _amount;
        _mint(_to, _purchaseReturn);
    }

    /// @notice The function to buy fractional tokens by deposting wei
    /// @dev We only update TWAV if it's the first transaction in a block and a buyout is active.
    ///      if current supply<initial supply,
    ///      then we first check if the order is only on secondary curve or if it extends till primary curve
    ///      if it extends, then we buy from current point to initial fractionalization point
    ///      and with the amount left, we buy by calling _buyPrimaryCurve
    /// @param _minAmtOut Amount in wei deposited for buying
    /// @param _to Address to send the bought tokens to
    function buy(uint256 _minAmtOut, address _to) external payable notBoughtOut lock {
        require(_to != address(0), " NibblVault: Zero address");
        //Make update on the first tx of the block
        if (status == Status.buyout) {
            uint32 _blockTimestamp = uint32(block.timestamp % 2**32);
            if (_blockTimestamp != lastBlockTimeStamp) {
                _updateTWAV(getCurrentValuation(), _blockTimestamp);   
                _rejectBuyout();
            }
        }
        uint256 _purchaseReturn;
        if (totalSupply() >= initialTokenSupply) { 
            _purchaseReturn = _buyPrimaryCurve(_to, msg.value);
        } else {
            uint256 _lowerCurveDiff = getMaxSecondaryCurveBalance() - secondaryReserveBalance;
            if (_lowerCurveDiff >= msg.value) {
                _purchaseReturn = _buySecondaryCurve(_to, msg.value);
            } else {
                //Gas Optimization
                _purchaseReturn = initialTokenSupply - totalSupply();
                secondaryReserveBalance += _lowerCurveDiff;
                _mint(_to, _purchaseReturn);
                // _purchaseReturn = _buySecondaryCurve(_to, _lowerCurveDiff);
                _purchaseReturn += _buyPrimaryCurve(_to, msg.value - _lowerCurveDiff);
            } 
        }
        require(_minAmtOut <= _purchaseReturn, "NibblVault: Insufficient amount out");
    }

    /// @dev This is executed when current supply>initial supply
    /// @param _amount Amount of tokens to be sold
    /// @return _saleReturn Sale Return
    function _sellPrimaryCurve(uint256 _amount) private returns(uint256 _saleReturn) {
        _saleReturn = _calculateSaleReturn(totalSupply(), primaryReserveBalance, primaryReserveRatio, _amount);
        primaryReserveBalance -= _saleReturn;
        _burn(msg.sender, _amount);
        _saleReturn = _chargeFee(_saleReturn);
    }

    /// @dev This is executed when current supply<=initial supply
    /// @param _amount Amount of tokens to be sold
    /// @return _saleReturn Sale Return
    function _sellSecondaryCurve(uint256 _amount) private returns(uint256 _saleReturn){
        _saleReturn = _calculateSaleReturn(totalSupply(), secondaryReserveBalance, secondaryReserveRatio, _amount);
        secondaryReserveBalance -= _saleReturn;
        _burn(msg.sender, _amount);
    }

    /// @notice The function to sell fractional tokens for reserve token
    /// @dev We only update TWAV if it's the first transaction in a block and a buyout is active.
    ///      if current supply>initial supply,
    ///      then we first check if the order is only on primary curve or if it extends till secondary curve.
    ///      if it extends, then we sell from current point to initial fractionalization point
    ///      and with the tokens left, we sell by calling _sellSecondaryCurve
    /// @param _amtIn Number of tokens to be sold
    /// @param _minAmtOut Amount in wei to be sent after a successful sell
    /// @param _to Address to send the reserve token to
    function sell(uint256 _amtIn, uint256 _minAmtOut, address _to) external notBoughtOut lock {
        require(_to != address(0), "NibblVault: Invalid address");
        //Make update on the first tx of the block
        if (status == Status.buyout) {
            uint32 _blockTimestamp = uint32(block.timestamp % 2**32);
            if (_blockTimestamp != lastBlockTimeStamp) {
                _updateTWAV(getCurrentValuation(), _blockTimestamp);   
                _rejectBuyout();
            }
        }
        uint256 _saleReturn;
        if(totalSupply() > initialTokenSupply) {
            if ((initialTokenSupply + _amtIn) <= totalSupply()) {
                _saleReturn = _sellPrimaryCurve(_amtIn);
            } else {
                //Gas Optimization
                uint256 _tokensPrimaryCurve = totalSupply() - initialTokenSupply;
                _saleReturn = primaryReserveBalance - fictitiousPrimaryReserveBalance;
                primaryReserveBalance -= _saleReturn;
                _burn(msg.sender, _tokensPrimaryCurve);
                _saleReturn = _chargeFee(_saleReturn);
                // _saleReturn = _sellPrimaryCurve(_tokensPrimaryCurve);
                _saleReturn += _sellSecondaryCurve(_amtIn - _tokensPrimaryCurve);
            } } else {
                _saleReturn = _sellSecondaryCurve(_amtIn);
        }
        require(_saleReturn >= _minAmtOut, "NibblVault: Insufficient amount out");
        (bool _success, ) = payable(_to).call{value: _saleReturn}("");
        require(_success, "NibblVault: Failed to send funds");
    }

    /// @notice Function to initiate buyout of a vault
    /// @dev Total bid amount is calculated as sum of primary and secondary reserve balances and the amount of money by user
    /// This ensures that the original bidder doesn't need to support the whole valuation and liquidity in reserve can be used as well.
    /// Buyout is initiated only when total bid amount is more than current curve valuation
    /// Buyout is triggered at current valuation and any extra amount deposited by bidder is refunded
    function initiateBuyout() public payable {
        require(status == Status.initialised, "NibblVault: Only when initialised");
        require(unsettledBids[msg.sender] == 0, "NibblVault: Unsettled Bids");
        uint256 _buyoutBid = msg.value + (primaryReserveBalance - fictitiousPrimaryReserveBalance) + secondaryReserveBalance;
        //_buyoutBid: Bid User has made
        uint256 _currentValuation = getCurrentValuation();
        require(_buyoutBid >= _currentValuation, "NibblVault: Bid too low");
        // buyoutValuationDeposit = _currentValuation - ((primaryReserveBalance - fictitiousPrimaryReserveBalance) + secondaryReserveBalance); 
        buyoutValuationDeposit = msg.value - (_buyoutBid - _currentValuation);
        bidder = msg.sender;
        buyoutBid = _currentValuation;
        // buyoutBid: Bid can only be placed at current valuation
        buyoutRejectionValuation = (_currentValuation * (SCALE + REJECTION_PREMIUM)) / SCALE;
        buyoutEndTime = block.timestamp + BUYOUT_DURATION;
        status = Status.buyout;
        _updateTWAV(_currentValuation, uint32(block.timestamp % 2**32));
        if (_buyoutBid > _currentValuation) {
            (bool _success, ) = payable(msg.sender).call{value: (_buyoutBid - _currentValuation)}(""); //Remaining amount is refunded to the bidder
            require(_success, "NibblVault: Failed to refund");
        }
        emit BuyoutInitiated(msg.sender, _buyoutBid);
    }

    /// @dev Triggered when someone buys tokens and curve valuation increases
    ///      Checks if TWAV >= Buyout rejection valuation and rejects current buyout
    function _rejectBuyout() internal notBoughtOut {
        uint256 _twav = _getTwav();
        if (_twav >= buyoutRejectionValuation) {
            uint256 _buyoutValuationDeposit = buyoutValuationDeposit;
            unsettledBids[bidder] = _buyoutValuationDeposit;
            totalUnsettledBids += _buyoutValuationDeposit;
            delete buyoutRejectionValuation;
            delete buyoutEndTime;
            delete bidder;
            delete twavObservations;
            delete twavObservationsIndex;
            status = Status.initialised;
            emit BuyoutRejected();
        }
    }

    /// @notice Function to allow withdrawal of unsuccessful buyout bids
    function withdrawUnsettledBids(address payable _to) public {
        uint _amount = unsettledBids[msg.sender];
        delete unsettledBids[msg.sender];
        totalUnsettledBids -= _amount;
        (bool _success, ) = _to.call{value: _amount}("");
        require(_success, "NibblVault: Failed to send funds");
    }

    /// @notice Function for tokenholders to redeem their tokens for reserve token in case of buyout
    /// @dev The redeemed reserve token are in proportion to the token supply someone owns
    ///      The amount available for redemption is contract balance - (value of total unsettled bid and curator fees accrued in contract)
    function redeem(address payable _to) public boughtOut lock returns(uint256 _amtOut){
        uint256 _balance = balanceOf(msg.sender);
        _amtOut = ((address(this).balance - feeAccruedCurator - totalUnsettledBids) * _balance) / totalSupply();
        _burn(msg.sender, _balance);
        (bool _success,) = _to.call{value: _amtOut}("");
        require(_success);
    }

    /// @notice Function for allowing bidder to unlock his NFT in case of buyout success
    /// @param _to the address where unlocked NFT will be sent
    function withdrawNFT(address _assetAddress, uint256 _assetID, address _to) external boughtOut {
        require(msg.sender == bidder,"NibblVault: Only winner");
        IERC721(_assetAddress).transferFrom(address(this), _to, _assetID);
    }

    function withdrawMultipleERC721(address[] memory _assetAddresses, uint256[] memory _assetIDs, address _to) external {
        require(msg.sender == bidder,"NibblVault: Only winner");
        for (uint256 i = 0; i < _assetAddresses.length; i++) {
            IERC721(_assetAddresses[i]).safeTransferFrom(address(this), _to, _assetIDs[i]);
        }
    }

    /// @notice Function to allow curator to redeem accumulated curator fee.
    /// @param _to the address where curator fee will be sent
    function redeemCuratorFee(address _to) public lock {
        require(msg.sender==curator,"NibblVault: Only Curator can redeem");
        (bool _success,) = payable(_to).call{value: feeAccruedCurator}("");
        feeAccruedCurator = 0;
        require(_success);
    }

    /// @notice Function to update curator fee
    /// @param _newFee New curator fee 
    function updateCuratorFee(uint256 _newFee) public {
        require(msg.sender == curator,"NibblVault: Only Curator");
        require(_newFee <= MAX_CURATOR_FEE(),"NibblVault: Invalid fee");
        curatorFee = _newFee;
        emit CuratorFeeUpdated(_newFee);
    }

    /// @notice withdraw ERC20 in the case a held NFT earned ERC20
    function withdrawERC20(address _asset, address _to) external boughtOut {
        require(msg.sender == bidder, "NibblVault: Only winner");
        IERC20(_asset).transfer(_to, IERC20(_asset).balanceOf(address(this)));
    }

    function withdrawMultipleERC20(address[] memory _assets, address _to) external boughtOut {
        require(msg.sender == bidder, "NibblVault: Only winner");
        for (uint256 i = 0; i < _assets.length; i++) {
            IERC20(_assets[i]).transfer(_to, IERC20(_assets[i]).balanceOf(address(this)));
        }
    }

    function withdrawERC1155(address _asset, uint256 _assetID, address _to) external boughtOut {
        require(msg.sender == bidder, "NibblVault: Only winner");
        uint256 balance = IERC1155(_asset).balanceOf(address(this),  _assetID);
        IERC1155(_asset).safeTransferFrom(address(this), _to, _assetID, balance, "0");
    }

    function withdrawMultipleERC1155(address[] memory _assets, uint256[] memory _assetIDs, address _to) external boughtOut {
        require(msg.sender == bidder, "NibblVault: Only winner");
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 balance = IERC1155(_assets[i]).balanceOf(address(this),  _assetIDs[i]);
            IERC1155(_assets[i]).safeTransferFrom(address(this), _to, _assetIDs[i], balance, "0");
        }
    }


    function onERC721Received( address, address, uint256, bytes calldata ) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }
    
    function onERC1155Received(address, address, uint256, uint256, bytes memory) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] memory, uint256[] memory, bytes memory) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }
}