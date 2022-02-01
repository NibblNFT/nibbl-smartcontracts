// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { BancorBondingCurve } from "./Bancor/BancorBondingCurve.sol";
import { IERC721 } from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import { IERC1155 } from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { NibblVaultFactory } from "./NibblVaultFactory.sol";
import { Twav } from "./Twav/Twav.sol";



/// @title Vault to lock NFTs and fractionalise ERC721 to ERC20s.
/// @dev This contract uses Bancor Formula to create a market for fractionalised ERC20s.
/// @dev This contract creates 2 bonding curves, referred to as primary curve and secondary curve.
/// @dev The primary curve has fixed specifications and fixed reserveRatio.
/// @dev The secondary curve is dynamic and has a variable reserveRatio, which depends on initial conditions given by the curator and the fee accumulated by the curve.
contract NibblVault is BancorBondingCurve, ERC20Upgradeable, Twav {

    /// @notice Scale for calculations to avoid rounding errors
    uint256 private constant SCALE = 1_000_000; 

    /// @notice Reserve ratio of primary curve 
    /// @dev primaryReserveRatio has been multiplied with SCALE
    /// @dev primaryReserveRatio lies between 0 and 1_000_000, 500_000 is equivalent to 50% reserve ratio
    uint32 private constant primaryReserveRatio = 500_000;
    
    /// @notice The premium percentage above the buyoutBid at which the buyout is rejected
    /// @dev REJECTION_PREMIUM has been multiplied with SCALE
    /// @dev REJECTION_PREMIUM lies between 0 and 1_000_000, i.e. 100_000 means 10%
    /// @dev if REJECTION_PREMIUM is 10% and the buyoutBid is 100, then the buyout is rejected when the valuation reaches 110
    uint256 private constant REJECTION_PREMIUM = 100_000; 

    /// @notice The days until which a buyout bid is valid, if it isn't rejected in buyout duration time, its automatically considered boughtOut
    uint256 private constant BUYOUT_DURATION = 3 days; 

    /// @notice The percentage of fee that goes for liquidity in lower curve until its reserve ratio becomes equal to primaryReserveRatio
    uint256 private constant CURVE_FEE_AMT = 4_000; 

    /// @notice The reserve ratio of the secondary curve.
    /// @dev secondaryReserveRatio has been multiplied with SCALE
    /// @dev secondaryReserveRatio lies between 0 and 1_000_000
    /// @dev secondary reserve ratio is dynamic and it can be <= primaryReserveRatio
    uint32 public secondaryReserveRatio;

    /// @notice address of factory contract
    address payable public factory;

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

    /// @notice fictitious primary reserve balance, this is used for calculation for trading along primary bonding curve.
    /// @dev This variable defines the amount of reserve token that should in the primary curve if 
    /// @dev the primary curve started from 0 and went till initialTokenSupply 
    uint256 private fictitiousPrimaryReserveBalance;

    /// @notice the valuation at which the buyout is rejected.
    uint256 public buyoutRejectionValuation; 
    
    /// @notice deposit made by bidder to initiate buyout 
    /// @dev buyoutValuationDeposit = currentValuation - ((reserveTokens in primary curve) - (reserveTokens in secondary curve))
    uint256 public buyoutValuationDeposit; 
    
    /// @notice initial token supply minted by curator
    uint256 public initialTokenSupply; 
    
    /// @notice reserve balance of the primary curve
    uint256 public primaryReserveBalance;
    
    /// @notice reserve balance of the secondary curve
    uint256 public secondaryReserveBalance;
    
    /// @notice total value of unclaimed fees accrued to the curator via trading on the bonding curve
    uint256 public feeAccruedCurator; 
    
    /// @notice the time at which the current buyout ends
    uint256 public buyoutEndTime; 
    
    /// @notice valuation at which buyout was triggered
    uint256 public buyoutBid;

    /// @notice percentage of trading fee on the bonding curve that goes to the curator
    uint256 public curatorFee;

    /// @notice total value of unclaimed buyout bids
    uint256 public totalUnsettledBids; 

    /// @notice mapping of buyout bidders and their respective unsettled bids
    mapping(address => uint256) public unsettledBids; 


    enum Status {initialised, buyout}

    ///@notice current status of vault
    Status public status;

    event BuyoutInitiated(address indexed bidder, uint256 indexed bid);
    event BuyoutRejected();
    event CuratorFeeUpdated(uint256 indexed fee);

    uint private unlocked;

    modifier lock() {
        require(unlocked == 1, 'NibblVault: LOCKED');
        unlocked = 0;
        _;
        unlocked = 1;
    }


    /// @notice To check if buyout hasn't succeed
    /// @dev Check for the case when buyoutTime has not ended or buyout has been rejected
    modifier notBoughtOut() {
        require(buyoutEndTime > block.timestamp || buyoutEndTime == 0,'NibblVault: Bought Out');
        _;
    }

    /// @notice To check if buyout has succeed
    /// @dev For the case when buyoutTime has succeeded and buyout has not been rejected
    modifier boughtOut() {
        require(status == Status.buyout, "NibblVault: status != buyout");
        require(buyoutEndTime <= block.timestamp, "NibblVault: buyoutEndTime <= now");
        _;
    }

    /// @notice To check if system isn't paused
    /// @dev pausablity implemented in factory
    modifier whenNotPaused() {
        require(!NibblVaultFactory(factory).paused(), 'NibblVault: Paused');
        _;
    }

    /// @notice To check if system is paused
    /// @dev pausablity has been implemented in factory
    modifier whenPaused() {
        require(NibblVaultFactory(factory).paused(), 'NibblVault: Not Paused');
        _;
    }

    /// @notice the function to initialise proxy vault parameters
    /// @param _tokenName name of the fractionalised ERC20 token to be created
    /// @param _tokenSymbol symbol of the fractionalised ERC20 token
    /// @param _assetAddress address of the ERC721 being fractionalised
    /// @param _assetID tokenId of the ERC721 being fractionalised
    /// @param _initialTokenSupply desired initial supply to be minted to curator
    /// @param _initialTokenPrice desired initial token price set by curator 
    /// @param _curatorFee fee percentage for curator
    /// @param _curator owner of the asset being fractionalized
    /// @dev valuation = price * supply
    /// @dev reserveBalance = valuation * reserveRatio
    /// @dev Reserve Ratio = Reserve Token Balance / (Continuous Token Supply x Continuous Token Price)
    function initialise(
        string memory _tokenName, 
        string memory _tokenSymbol, 
        address _assetAddress,
        uint256 _assetID,
        address _curator,
        uint256 _initialTokenSupply,
        uint256 _initialTokenPrice,
        uint256 _curatorFee
    ) external initializer payable {
        __ERC20_init(_tokenName, _tokenSymbol);
        unlocked = 1;
        curatorFee = _curatorFee;
        initialTokenPrice=_initialTokenPrice;
        factory = payable(msg.sender);
        assetAddress = _assetAddress;
        assetID = _assetID;
        curator = _curator;
        initialTokenSupply = _initialTokenSupply;
        uint _primaryReserveBalance = (primaryReserveRatio * _initialTokenSupply * _initialTokenPrice) / (SCALE * 1e18);
        primaryReserveBalance = _primaryReserveBalance;
        fictitiousPrimaryReserveBalance = _primaryReserveBalance;
        secondaryReserveBalance = msg.value;
        uint32 _secondaryReserveRatio = uint32((msg.value * SCALE * 1e18) / (_initialTokenSupply * _initialTokenPrice));
        secondaryReserveRatio = _secondaryReserveRatio;
        require(_curatorFee <= MAX_CURATOR_FEE(), "NibblVault: Invalid fee");
        require(_secondaryReserveRatio <= primaryReserveRatio, "NibblVault: Excess initial funds");
        require(_secondaryReserveRatio >= 1_000, "NibblVault: secResRatio too low");
        _mint(_curator, _initialTokenSupply);
    }

    /// @notice Function used to charge fee on trades
    /// @dev There are 3 different fees charged - admin, curator and curve
    /// @dev Admin fee percentage is fetched from the factory contract and the fee charged is transferred to factory contract
    /// @dev Curator fee is fetched from curatorFee variable and total fee accrued is stored in feeAccruedCurator variable
    /// @dev Curve fee is fetched from the CURVE_FEE_AMT variable and is added to the secondaryReserveBalance variable
    /// @param _amount amount to charge fee on either a buy or sell order, fee is charged in reserve token
    /// @return the amount after fee is deducted
    function _chargeFee(uint256 _amount) private returns(uint256){
        address payable _factory = factory;
        uint256 _adminFeeAmt = NibblVaultFactory(_factory).feeAdmin();
        uint256 _curatorFeeAmt = curatorFee;
        uint256 _feeAdmin = (_amount * _adminFeeAmt) / SCALE ;
        uint256 _feeCurator = (_amount * _curatorFeeAmt) / SCALE ;
        uint256 _feeCurve = (_amount * CURVE_FEE_AMT) / SCALE ;
        feeAccruedCurator += _feeCurator;
        uint256 _maxSecondaryBalanceIncrease = fictitiousPrimaryReserveBalance - secondaryReserveBalance;
        _feeCurve = _maxSecondaryBalanceIncrease > _feeCurve ? _feeCurve : _maxSecondaryBalanceIncrease; // the curve fee is capped so that secondaryReserveBalance <= fictitiousPrimaryReserveBalance
        secondaryReserveBalance += _maxSecondaryBalanceIncrease > _feeCurve ? _feeCurve : _maxSecondaryBalanceIncrease;
        secondaryReserveRatio = uint32((secondaryReserveBalance * SCALE * 1e18) / (initialTokenSupply * initialTokenPrice)); //secondaryReserveRatio is updated on every trade 
        if(_adminFeeAmt > 0) {
            safeTransferETH(_factory, _feeAdmin); //Transfers admin fee to the factory contract
        }
        return _amount - (_feeAdmin + _feeCurator + _feeCurve);
    }

    /// @notice Maximum number of reserve tokens that can be held on SecondaryCurve at current secondary reserve ratio
    /// @dev The max continous tokens on SecondaryCurve is equal to initialTokenSupply
    /// @dev Reserve Token Balance = Reserve Ratio * (Continuous Token Supply x Continuous Token Price)
    function getMaxSecondaryCurveBalance() private view returns(uint256){
            return ((secondaryReserveRatio * initialTokenSupply * initialTokenPrice) / (1e18 * SCALE));
    }

    /// @notice gives current valuation of the system
    /// @dev valuation = price * supply
    /// @dev fictitiousPrimaryReserveBalance doesn't denote any actual reserve balance its just for calculation purpose
    /// @dev Actual reserve balance in primary curve = primaryReserveBalance - fictitiousPrimaryReserveBalance
    /// @dev Total reserve balance = Actual reserve balance in primary curve + secondaryReserveBalance
    /// @dev Total reserve balance = (primaryReserveBalance - fictitiousPrimaryReserveBalance) + secondaryReserveBalance
    /// @dev Valuation = (Continuous Token Supply x Continuous Token Price) = Reserve Token Balance / Reserve Ratio
    /// @return Current valuation of the system
    function getCurrentValuation() private view returns(uint256){
            return totalSupply() < initialTokenSupply ? (secondaryReserveBalance * SCALE /secondaryReserveRatio) : ((primaryReserveBalance) * SCALE  / primaryReserveRatio);
    }

    /// @notice Maximum curator fee curator can levied by curator 
    /// @dev Maximum curator fee is increases once secondaryReserveRatio = primaryReserveRatio
    /// @dev Maximum curator fee is multiplied with SCALE, i.e. 5000 = (5000 / SCALE) * 100 = 0.5% 
    /// @return Maximum curator fee
    function MAX_CURATOR_FEE() view private returns (uint256) {
        if (secondaryReserveRatio < primaryReserveRatio) {
            return 5_000;
        } else {
            return 10_000;
        }            
    }

    /// @notice function to buy tokens on primary curve
    /// @param _amount amount of reserve tokens to buy continous tokens
    /// @dev This is executed when current supply >= initial supply
    /// @dev _amount is charged with fee
    /// @dev _purchaseReturn is minted to _to
    /// @return _purchaseReturn Purchase return
    function _buyPrimaryCurve(uint256 _amount, uint256 _totalSupply) private returns (uint256 _purchaseReturn) {
        uint256 _amountIn = _chargeFee(_amount);
        _purchaseReturn = _calculatePurchaseReturn(_totalSupply, primaryReserveBalance, primaryReserveRatio, _amountIn);
        primaryReserveBalance += _amountIn;
    }
    /// @notice function to buy tokens on secondary curve
    /// @param _amount amount of reserve tokens to buy continous  tokens
    /// @dev This is executed when current supply < initial supply
    /// @dev fee isn't levied on secondary curve
    /// @dev _purchaseReturn is minted to _to
    /// @return _purchaseReturn Purchase return
    function _buySecondaryCurve(uint256 _amount, uint256 _totalSupply) private returns (uint256 _purchaseReturn) {
        _purchaseReturn = _calculatePurchaseReturn(_totalSupply, secondaryReserveBalance, secondaryReserveRatio, _amount);
        secondaryReserveBalance += _amount;
    }

    /// @notice The function to buy fractional tokens for reserveTokens
    /// @dev TWAV is updated only if buyout is active and only on first buy or sell txs of block.
    /// @dev It internally calls _buyPrimaryCurve or _buySecondaryCurve or both depending on the buyAmount and current supply
    /// @dev if current totalSupply < initialTokenSupply AND _amount to buy tokens for is greater than (maxSecondaryCurveBalance - currentSecondaryCurveBalance) then buy happens on secondary curve and primary curve both
    /// @param _minAmtOut Amount of reserveTokens to buy continous tokens for
    /// @param _to Address to mint the purchase return to
    function buy(uint256 _minAmtOut, address _to) external payable notBoughtOut lock whenNotPaused {
        //Make update on the first tx of the block
        if (status == Status.buyout) {
            uint32 _blockTimestamp = uint32(block.timestamp % 2**32);
            if (_blockTimestamp != lastBlockTimeStamp) {
                _updateTWAV(getCurrentValuation(), _blockTimestamp);   
                _rejectBuyout();
            }
        }
        uint256 _purchaseReturn;
        uint256 _initialTokenSupply = initialTokenSupply;
        uint256 _totalSupply = totalSupply();
        if (_totalSupply >= _initialTokenSupply) {
            _purchaseReturn = _buyPrimaryCurve(msg.value, _totalSupply);
        } else {
            uint256 _lowerCurveDiff = getMaxSecondaryCurveBalance() - secondaryReserveBalance;
            if (_lowerCurveDiff >= msg.value) {
                _purchaseReturn = _buySecondaryCurve(msg.value, _totalSupply);
            } else {
                //Gas Optimization
                _purchaseReturn = _initialTokenSupply - _totalSupply;
                secondaryReserveBalance += _lowerCurveDiff;
                // _purchaseReturn = _buySecondaryCurve(_to, _lowerCurveDiff);
                _purchaseReturn += _buyPrimaryCurve(msg.value - _lowerCurveDiff, _totalSupply + _purchaseReturn);
            } 
        }
        require(_minAmtOut <= _purchaseReturn, "NibblVault: Return too low");
        _mint(_to, _purchaseReturn);
    }

    /// @notice The function to sell fractional tokens on primary curve
    /// @dev Executed when currentSupply > initialSupply
    /// @dev _amount is charged with fee
    /// @param _amount Amount of tokens to be sold on primary curve
    /// @return _saleReturn Sale Return
    function _sellPrimaryCurve(uint256 _amount, uint256 _totalSupply) private returns(uint256 _saleReturn) {
        _saleReturn = _calculateSaleReturn(_totalSupply, primaryReserveBalance, primaryReserveRatio, _amount);
        primaryReserveBalance -= _saleReturn;
        _saleReturn = _chargeFee(_saleReturn);
    }

    /// @notice The function to sell fractional tokens on secondary curve
    /// @dev Executed when current supply <= initial supply
    /// @dev fee ins't levied on secondary curve
    /// @param _amount Amount of tokens to be sold on SecondaryCurve
    ///  @return _saleReturn Sale Return
    function _sellSecondaryCurve(uint256 _amount, uint256 _totalSupply) private returns(uint256 _saleReturn){
        _saleReturn = _calculateSaleReturn(_totalSupply, secondaryReserveBalance, secondaryReserveRatio, _amount);
        secondaryReserveBalance -= _saleReturn;
    }

    /// @notice The function to sell fractional tokens for reserve token
    /// @dev TWAV is updated only if buyout is active and only on first buy or sell txs of block.
    /// @dev internally calls _sellPrimaryCurve or _sellSecondaryCurve or both depending on the sellAmount and current supply
    /// @dev if totalSupply > initialTokenSupply AND _amount to sell is greater than (_amtIn > totalSupply - initialTokenSupply) then sell happens on primary curve and secondary curve both
    /// @param _amtIn Continous Tokens to be sold
    /// @param _minAmtOut Reserve Tokens to be sent after a successful sell
    /// @param _to Address to recieve the reserve token to
    function sell(uint256 _amtIn, uint256 _minAmtOut, address payable _to) external notBoughtOut lock whenNotPaused{
        //Make update on the first tx of the block
        if (status == Status.buyout) {
            uint32 _blockTimestamp = uint32(block.timestamp % 2**32);
            if (_blockTimestamp != lastBlockTimeStamp) {
                _updateTWAV(getCurrentValuation(), _blockTimestamp);   
                _rejectBuyout();
            }
        }
        uint256 _saleReturn;
        uint256 _initialTokenSupply = initialTokenSupply;
        uint256 _totalSupply = totalSupply();
        if(_totalSupply > _initialTokenSupply) {
            if ((_initialTokenSupply + _amtIn) <= _totalSupply) {
                _saleReturn = _sellPrimaryCurve(_amtIn, _totalSupply);
            } else {
                //Gas Optimization
                uint256 _tokensPrimaryCurve = _totalSupply - _initialTokenSupply;
                _saleReturn = primaryReserveBalance - fictitiousPrimaryReserveBalance;
                primaryReserveBalance -= _saleReturn;
                _saleReturn = _chargeFee(_saleReturn);
                // _saleReturn = _sellPrimaryCurve(_tokensPrimaryCurve);
                _saleReturn += _sellSecondaryCurve(_amtIn - _tokensPrimaryCurve, _totalSupply - _tokensPrimaryCurve);
            } } else {
                _saleReturn = _sellSecondaryCurve(_amtIn,_totalSupply);
        }
        require(_saleReturn >= _minAmtOut, "NibblVault: Return too low");
        _burn(msg.sender, _amtIn);
        safeTransferETH(_to, _saleReturn); //send _saleReturn to _to
    }

    /// @notice Function to initiate buyout of ERC721
    /// @dev buyoutBid is set to current valuation
    /// @dev bidder needs to send funds equal to current valuation - ((primaryReserveBalance - fictitiousPrimaryReserveBalance) + secondaryReserveBalance) to initiate buyout
    /// This ensures that the original bidder doesn't need to support the whole valuation and liquidity in reserve can be used as well.
    /// Buyout is initiated only when total bid amount >= currentValuation but extra funds over currentValuation are sent back to user
    function initiateBuyout() external payable whenNotPaused {
        require(status == Status.initialised, "NibblVault: Status!=Initialised");
        //TODO: remove below statement
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
            safeTransferETH(payable(msg.sender), (_buyoutBid - _currentValuation));
        }
        emit BuyoutInitiated(msg.sender, _buyoutBid);
    }

    /// @notice Function to reject buyout
    /// @dev Triggered when someone buys tokens and curve valuation increases
    /// @dev If TWAV >= Buyout rejection valuation then the buyout is rejected
    /// @dev Called only when TWAV is updated
    function _rejectBuyout() private notBoughtOut {
        uint256 _twav = _getTwav();
        if (_twav >= buyoutRejectionValuation) {
            uint256 _buyoutValuationDeposit = buyoutValuationDeposit;
            unsettledBids[bidder] += _buyoutValuationDeposit;
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

    /// @notice Function to allow withdrawal of unsettledBids after buyout has been rejected
    /// @param _to Address to recieve the funds
    function withdrawUnsettledBids(address payable _to) external {
        uint _amount = unsettledBids[msg.sender];
        delete unsettledBids[msg.sender];
        totalUnsettledBids -= _amount;
        safeTransferETH(_to, _amount);
    }

    /// @notice Function for tokenholders to redeem their tokens for reserve token in case of buyout success
    /// @dev The redeemed reserve token are in proportion to the token supply someone owns
    /// @dev The amount available for redemption is contract balance - (total unsettled bid and curator fees accrued)
    function redeem(address payable _to) external boughtOut returns(uint256 _amtOut){
        uint256 _balance = balanceOf(msg.sender);
        _amtOut = ((address(this).balance - feeAccruedCurator - totalUnsettledBids) * _balance) / totalSupply();
        _burn(msg.sender, _balance);
        safeTransferETH(_to, _amtOut);
    }

    /// @notice Function for tokenholders to redeem their tokens for reserve token when system is paused
    /// @dev The redeemed reserve token are in proportion to the token supply someone owns
    /// @dev The amount available for redemption is contract balance - (value of total unsettled bid and curator fees accrued in contract)
    function unlockFundsWhenPaused(address payable _to) external whenPaused returns(uint256 _amtOut){
        uint256 _balance = balanceOf(msg.sender);
        _amtOut = ((address(this).balance - feeAccruedCurator - totalUnsettledBids) * _balance) / totalSupply();
        _burn(msg.sender, _balance);
        safeTransferETH(_to, _amtOut);
    }

    /// @notice Function to allow curator to redeem accumulated curator fee.
    /// @param _to the address where curator fee will be sent
    /// @dev can only be called by curator
    function redeemCuratorFee(address payable _to) external lock {
        require(msg.sender==curator,"NibblVault: Only Curator");
        safeTransferETH(_to, feeAccruedCurator);
        feeAccruedCurator = 0;
    }

    /// @notice Function to update curator fee percentage
    /// @param _newFee New curator fee 
    /// @dev can only be called by curator
    function updateCuratorFee(uint256 _newFee) external {
        require(msg.sender == curator,"NibblVault: Only Curator");
        require(_newFee <= MAX_CURATOR_FEE(),"NibblVault: Invalid fee");
        curatorFee = _newFee;
        emit CuratorFeeUpdated(_newFee);
    }

    /// @notice Function for allowing bidder to unlock his ERC721 in case of buyout success
    /// @param _to the address where unlocked NFT will be sent
    function withdrawERC721(address _assetAddress, uint256 _assetID, address _to) external boughtOut {
        require(msg.sender == bidder,"NibblVault: Only winner");
        IERC721(_assetAddress).safeTransferFrom(address(this), _to, _assetID);
    }

    ///@notice withdraw multiple ERC721s
    function withdrawMultipleERC721(address[] memory _assetAddresses, uint256[] memory _assetIDs, address _to) external boughtOut {
        require(msg.sender == bidder,"NibblVault: Only winner");
        for (uint256 i = 0; i < _assetAddresses.length; i++) {
            IERC721(_assetAddresses[i]).safeTransferFrom(address(this), _to, _assetIDs[i]);
        }
    }

    /// @notice Function for allowing bidder to unlock his ERC20s in case of buyout success
    /// @notice ERC20s can be accumulated as royalty
    /// @param _to the address where unlocked NFT will be sent
    function withdrawERC20(address _asset, address _to) external boughtOut {
        require(msg.sender == bidder, "NibblVault: Only winner");
        IERC20(_asset).transfer(_to, IERC20(_asset).balanceOf(address(this)));
    }


    /// @notice withdraw multiple ERC20s
    function withdrawMultipleERC20(address[] memory _assets, address _to) external boughtOut {
        require(msg.sender == bidder, "NibblVault: Only winner");
        for (uint256 i = 0; i < _assets.length; i++) {
            IERC20(_assets[i]).transfer(_to, IERC20(_assets[i]).balanceOf(address(this)));
        }
    }

    /// @notice Function for allowing bidder to unlock his ERC1155s in case of buyout success
    /// @notice ERC1155s can be accumulated as royalty
    /// @param _to the address where unlocked NFT will be sent
    function withdrawERC1155(address _asset, uint256 _assetID, address _to) external boughtOut {
        require(msg.sender == bidder, "NibblVault: Only winner");
        uint256 balance = IERC1155(_asset).balanceOf(address(this),  _assetID);
        IERC1155(_asset).safeTransferFrom(address(this), _to, _assetID, balance, "0");
    }

    /// @notice withdraw multiple ERC1155s
    function withdrawMultipleERC1155(address[] memory _assets, uint256[] memory _assetIDs, address _to) external boughtOut {
        require(msg.sender == bidder, "NibblVault: Only winner");
        for (uint256 i = 0; i < _assets.length; i++) {
            uint256 balance = IERC1155(_assets[i]).balanceOf(address(this),  _assetIDs[i]);
            IERC1155(_assets[i]).safeTransferFrom(address(this), _to, _assetIDs[i], balance, "0");
        }
    }

    /// @notice Function to unlock ERC721 when paused
    /// @notice this can only be called by a user with pauser role
    function withdrawERC721WhenPaused(address _assetAddress, uint256 _assetID, address _to) external whenPaused {
        require(NibblVaultFactory(factory).hasRole(NibblVaultFactory(factory).PAUSER_ROLE(), msg.sender),"NibblVault: Only PauserRole");
        IERC721(_assetAddress).safeTransferFrom(address(this), _to, _assetID);
    }

    /// @notice Function to unlock ERC20s when paused
    /// @notice this can only be called by a user with pauser role
    function withdrawERC20WhenPaused(address _asset, address _to) external whenPaused {
        require(NibblVaultFactory(factory).hasRole(NibblVaultFactory(factory).PAUSER_ROLE(), msg.sender),"NibblVault: Only PauserRole");
        IERC20(_asset).transfer(_to, IERC20(_asset).balanceOf(address(this)));
    }

    
    /// @notice Function to unlock ERC1155s when paused
    /// @notice this can only be called by a user with pauser role
    function withdrawERC1155WhenPaused(address _asset, uint256 _assetID, address _to) external whenPaused {
        require(NibblVaultFactory(factory).hasRole(NibblVaultFactory(factory).PAUSER_ROLE(), msg.sender),"NibblVault: Only PauserRole");
        uint256 balance = IERC1155(_asset).balanceOf(address(this),  _assetID);
        IERC1155(_asset).safeTransferFrom(address(this), _to, _assetID, balance, "0");
    }

    function safeTransferETH(address payable _to, uint256 _amount) private {
        (bool success, ) = _to.call{value: _amount}("");
        require(success, "NibblVault: ETH transfer failed");
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

    receive() external payable {}
}