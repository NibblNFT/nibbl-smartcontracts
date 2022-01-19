import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { mintTokens, burnTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime , increaseTime } from "./testHelpers/time";
import { TWAV } from "./testHelpers/twavHelper";

describe("Buyout", function () {
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e9);
  const decimal = BigNumber.from((1e18).toString());
  const FEE_ADMIN: BigNumber = BigNumber.from(2_000_000);
  const FEE_CURATOR: BigNumber = BigNumber.from(4_000_000);
  const FEE_CURVE: BigNumber = BigNumber.from(4_000_000);
  const MAX_FEE_ADMIN: BigNumber = BigNumber.from(2_000_000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4_000_000);
  const MAX_FEE_CURVE: BigNumber = BigNumber.from(4_000_000);
  const rejectionPremium: BigNumber = BigNumber.from(100_000_000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500_000_000);
  const BUYOUT_DURATION: BigNumber = BigNumber.from(3 * 24 * 60 * 60);   
  const THREE_MINS: BigNumber = BigNumber.from(180)
  let blockTime: BigNumber = BigNumber.from(Math.ceil((Date.now() / 1e3)));
  const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
  const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
  const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
  const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
  const requiredReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
  const primaryReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const fictitiousPrimaryReserveBalance = primaryReserveRatio.mul(initialValuation).div(SCALE);

  beforeEach(async function () {
    const [curator, admin, buyer1, buyer2, addr1, addr2, addr3, addr4] = await ethers.getSigners();
    this.curator = curator;
    this.admin = admin;
    this.buyer1 = buyer1;
    this.buyer2 = buyer2;
    this.addr1 = addr1;
    this.addr2 = addr2;
    this.addr3 = addr3;
    this.addr4 = addr4;

    this.NFT = await ethers.getContractFactory("NFT");
    this.nft = await this.NFT.deploy();
    await this.nft.deployed();
    this.nft.mint(this.curator.address, 0);

    this.NibblVault = await ethers.getContractFactory("NibblVault");
    this.nibblVaultImplementation = await this.NibblVault.deploy();
    await this.nibblVaultImplementation.deployed();
// Basket
    this.Basket = await ethers.getContractFactory("Basket");
    this.basketImplementation = await this.Basket.deploy();
    await this.basketImplementation.deployed();

    this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    this.tokenVaultFactory = await this.NibblVaultFactory.deploy(this.nibblVaultImplementation.address, this.basketImplementation.address, this.admin.address);
    await this.tokenVaultFactory.deployed();
    this.nft.approve(this.tokenVaultFactory.address, 0);

    this.TestBancorBondingCurve = await ethers.getContractFactory("TestBancorBondingCurve");
    this.TestTWAVContract = await ethers.getContractFactory("TestTwav");
    this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
    this.testTWAV = await this.TestTWAVContract.deploy();
    await this.testTWAV.deployed();
    await this.testBancorBondingCurve.deployed();

    await this.tokenVaultFactory.createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply, 10 ** 14, MAX_FEE_CURATOR, { value: initialSecondaryReserveBalance });
    const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
    this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.NibblVault.interface, this.curator);
    this.twav = new TWAV();
  });

  it("Should initiate buyout when bid == currentValuation", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const currentValuation: BigNumber = initialValuation;
    const initialTokenVaultBalance: BigNumber = await this.buyer1.provider.getBalance(this.tokenVault.address);
    const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    expect(await this.tokenVault.buyoutValuationDeposit()).to.equal(buyoutBidDeposit);
    expect(await this.tokenVault.bidder()).to.equal(this.buyer1.address);
    expect(await this.tokenVault.buyoutBid()).to.equal(currentValuation);
    expect(await this.tokenVault.buyoutEndTime()).to.equal(blockTime.add(BUYOUT_DURATION));
    expect(await this.tokenVault.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);
    expect(await this.tokenVault.status()).to.equal(1);
    expect(await this.tokenVault.lastBlockTimeStamp()).to.equal(blockTime);
    expect(await this.buyer1.provider.getBalance(this.tokenVault.address)).to.equal(initialTokenVaultBalance.add(buyoutBidDeposit));
    const twavObs = await this.tokenVault.twavObservations(0);
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[0].cumulativeValuation);
  });

  it("Should initiate buyout when bid >= currentValuation", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const currentValuation: BigNumber = initialValuation;
    const initialTokenVaultBalance: BigNumber = await this.buyer1.provider.getBalance(this.tokenVault.address);
    const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    expect(await this.tokenVault.buyoutValuationDeposit()).to.equal(buyoutBidDeposit);
    expect(await this.tokenVault.bidder()).to.equal(this.buyer1.address);
    expect(await this.tokenVault.buyoutBid()).to.equal(currentValuation);
    expect(await this.tokenVault.buyoutEndTime()).to.equal(blockTime.add(BUYOUT_DURATION));
    expect(await this.tokenVault.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);
    expect(await this.tokenVault.status()).to.equal(1);
    expect(await this.tokenVault.lastBlockTimeStamp()).to.equal(blockTime);
    expect(await this.buyer1.provider.getBalance(this.tokenVault.address)).to.equal(initialTokenVaultBalance.add(buyoutBidDeposit));
    const twavObs = await this.tokenVault.twavObservations(0)
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[0].cumulativeValuation);
  });

  it("Should update twav on buy when in buyout", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    const twavObs = await this.tokenVault.twavObservations(0);
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[0].cumulativeValuation);
    // -------------------------Buyout Initiated--------------------------
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const _buyAmount = ethers.utils.parseEther("1");
    const _feeTotal = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);
    const _initialSecondaryBalance = await this.tokenVault.secondaryReserveBalance();
    const _initialPrimaryBalance = await this.tokenVault.primaryReserveBalance();
    const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(SCALE));
    const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
    const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    const _newSecondaryResRatio = _newSecondaryBalance.mul(SCALE).div(initialValuation);
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
    const twavObs1 = await this.tokenVault.twavObservations(1)
    expect(twavObs1.timestamp).to.equal(this.twav.twavObservations[1].timestamp);
    expect(twavObs1.cumulativeValuation).to.equal(this.twav.twavObservations[1].cumulativeValuation);
    // ----------------------------1st Buy Operation-----------------------------------  
    // ----------------------------2nd Buy Operation Initiated-----------------------------------  
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    currentValuation = (_newSecondaryBalance.mul(SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(fictitiousPrimaryReserveBalance)).mul(SCALE).div(primaryReserveRatio));
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
    const twavObs2 = await this.tokenVault.twavObservations(2)
    expect(twavObs2.timestamp).to.equal(this.twav.twavObservations[2].timestamp);
    expect(twavObs2.cumulativeValuation).to.equal(this.twav.twavObservations[2].cumulativeValuation);
    // ----------------------------2nd Buy Operation-----------------------------------  
  });

  it("Should update twav on sell when in buyout", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    const twavObs = await this.tokenVault.twavObservations(0);
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[0].cumulativeValuation);
    // -------------------------Buyout Initiated--------------------------
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const _sellAmount = initialTokenSupply.div(5);
    let _balanceAddr1 = await this.addr1.provider.getBalance(this.addr1.address);
    const _expectedSaleReturn = await burnTokens(this.testBancorBondingCurve, initialTokenSupply, initialSecondaryReserveBalance, initialSecondaryReserveRatio, _sellAmount);        
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.curator).sell(_sellAmount, _expectedSaleReturn, this.addr1.address);
    expect(await this.tokenVault.balanceOf(this.curator.address)).to.equal(initialTokenSupply.sub(_sellAmount));
    expect((await this.addr1.provider.getBalance(this.addr1.address)).sub(_balanceAddr1)).to.equal((_expectedSaleReturn));        
    expect(await this.tokenVault.secondaryReserveBalance()).to.equal(initialSecondaryReserveBalance.sub(_expectedSaleReturn));
    expect(await this.tokenVault.totalSupply()).to.equal(initialTokenSupply.sub(_sellAmount));
    const twavObs1 = await this.tokenVault.twavObservations(1)
    expect(twavObs1.timestamp).to.equal(this.twav.twavObservations[1].timestamp);
    expect(twavObs1.cumulativeValuation).to.equal(this.twav.twavObservations[1].cumulativeValuation);
    // ----------------------------1st Sell Operation-----------------------------------  
    // ----------------------------2nd Sell Operation Initiated-----------------------------------  
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const _newSecondaryBalance = initialSecondaryReserveBalance.sub(_expectedSaleReturn);
    const _newSecondaryResRatio = initialSecondaryReserveRatio;//SecResRatio doesnt change
    expect(await this.tokenVault.secondaryReserveBalance()).to.equal(_newSecondaryBalance);
    currentValuation = (_newSecondaryBalance.mul(SCALE).div(_newSecondaryResRatio));
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.curator).sell(_sellAmount, 0, this.addr1.address);
    const twavObs2 = await this.tokenVault.twavObservations(2)
    expect(twavObs2.timestamp).to.equal(this.twav.twavObservations[2].timestamp);
    expect(twavObs2.cumulativeValuation).to.equal(this.twav.twavObservations[2].cumulativeValuation);
    // ----------------------------2nd Buy Operation-----------------------------------  
  });

  
  it("Should reject buyout", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    const twavObs = await this.tokenVault.twavObservations(0);
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[0].cumulativeValuation);
    // -------------------------Buyout Initiated--------------------------

    for (let index = 0; true; index++) {
      blockTime = blockTime.add(THREE_MINS);      
      await setTime(blockTime.toNumber());        
      const _buyAmount = ethers.utils.parseEther("2");      
      const _feeTotal = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);
      const _initialSecondaryBalance = await this.tokenVault.secondaryReserveBalance();
      const _initialPrimaryBalance = await this.tokenVault.primaryReserveBalance();
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(SCALE));
      const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
      const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
      const _newSecondaryResRatio = _newSecondaryBalance.mul(SCALE).div(initialValuation);
      this.twav.addObservation(currentValuation, blockTime);
      let twavObs = await this.tokenVault.twavObservations(index % 6)
      await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
      currentValuation = (_newSecondaryBalance.mul(SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(fictitiousPrimaryReserveBalance)).mul(SCALE).div(primaryReserveRatio));
      // expect(twavObs.timestamp).to.equal(this.twav.twavObservations[index % 6].timestamp);
      // expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[index % 6].cumulativeValuation);
      if (this.twav.getTwav() >= buyoutRejectionValuation) {
        await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
        expect(await this.tokenVault.buyoutRejectionValuation()).to.equal(ethers.constants.Zero);
        expect(await this.tokenVault.buyoutEndTime()).to.equal(ethers.constants.Zero);
        expect((await this.tokenVault.bidder())).to.equal(ethers.constants.AddressZero);
        expect((await this.tokenVault.twavObservations(0))[0]).to.equal(ethers.constants.Zero);
        expect(await this.tokenVault.twavObservationsIndex()).to.equal(ethers.constants.Zero);
        expect(await this.tokenVault.totalUnsettledBids()).to.equal(buyoutBidDeposit);
        expect(await this.tokenVault.unsettledBids(this.buyer1.address)).to.equal(buyoutBidDeposit);
        break;
      }
    }
  });


  it("Shouldn't be able to buy after buyout has been completed.", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await increaseTime(3, "days");
    const _buyAmount = ethers.utils.parseEther("2");      
    await expect(this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount })).to.be.revertedWith("NFT has been bought");
  });


  it("Shouldn't be able to sell after buyout has been completed.", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await increaseTime(3, "days");
    const _sellAmount = initialTokenSupply.div(5);
    await expect(this.tokenVault.connect(this.curator).sell(_sellAmount, 0, this.addr1.address)).to.be.revertedWith("NFT has been bought");
  });

  it("Shouldn't be able to initiate buyout with buyout already going on", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await expect(this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit })).to.be.revertedWith("NibblVault: Only when initialised");
  });

  it("User shouldn't be able to initiate buyout with unsettled bids.", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//

    for (let index = 0; true; index++) {
      blockTime = blockTime.add(THREE_MINS);      
      await setTime(blockTime.toNumber());        
      const _buyAmount = ethers.utils.parseEther("2");      
      const _feeTotal = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);
      const _initialSecondaryBalance = await this.tokenVault.secondaryReserveBalance();
      const _initialPrimaryBalance = await this.tokenVault.primaryReserveBalance();
      const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(SCALE));
      const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
      const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
      const _newSecondaryResRatio = _newSecondaryBalance.mul(SCALE).div(initialValuation);
      this.twav.addObservation(currentValuation, blockTime);
      await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
      currentValuation = (_newSecondaryBalance.mul(SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(fictitiousPrimaryReserveBalance)).mul(SCALE).div(primaryReserveRatio));
      if (this.twav.getTwav() >= buyoutRejectionValuation) {
        break;
      }
    }
    // --------------------- Buyout Rejected--------------------------//
    await expect(this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit })).to.be.revertedWith("NibblVault: Unsettled Bids");
  });


  it("User should be able to withdraw unsettled bids", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//

    for (let index = 0; true; index++) {
      blockTime = blockTime.add(THREE_MINS);      
      await setTime(blockTime.toNumber());        
      const _buyAmount = ethers.utils.parseEther("2");      
      const _feeTotal = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);
      const _initialSecondaryBalance = await this.tokenVault.secondaryReserveBalance();
      const _initialPrimaryBalance = await this.tokenVault.primaryReserveBalance();
      const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(SCALE));
      const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
      const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
      const _newSecondaryResRatio = _newSecondaryBalance.mul(SCALE).div(initialValuation);
      this.twav.addObservation(currentValuation, blockTime);
      await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
      currentValuation = (_newSecondaryBalance.mul(SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(fictitiousPrimaryReserveBalance)).mul(SCALE).div(primaryReserveRatio));
      if (this.twav.getTwav() >= buyoutRejectionValuation) {
        break;
      }
    }
    // --------------------- Buyout Rejected--------------------------//
    const initialBal = await this.buyer1.provider.getBalance(this.tokenVault.address)
    await this.tokenVault.connect(this.buyer1).withdrawUnsettledBids(this.addr1.address);
    expect(await this.buyer1.provider.getBalance(this.tokenVault.address)).to.be.equal(initialBal.sub(buyoutBidDeposit));
  });


  it("User should be able to initiate buyout after withdrawing unsettled bids", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//

    for (let index = 0; true; index++) {
      blockTime = blockTime.add(THREE_MINS);      
      await setTime(blockTime.toNumber());        
      const _buyAmount = ethers.utils.parseEther("2");      
      const _feeTotal = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);
      const _initialSecondaryBalance = await this.tokenVault.secondaryReserveBalance();
      const _initialPrimaryBalance = await this.tokenVault.primaryReserveBalance();
      const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(SCALE));
      const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
      const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
      const _newSecondaryResRatio = _newSecondaryBalance.mul(SCALE).div(initialValuation);
      this.twav.addObservation(currentValuation, blockTime);
      await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
      currentValuation = (_newSecondaryBalance.mul(SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(fictitiousPrimaryReserveBalance)).mul(SCALE).div(primaryReserveRatio));
      if (this.twav.getTwav() >= buyoutRejectionValuation) {
        break;
      }
    }
    // --------------------- Buyout Rejected--------------------------//
    const initialBal = await this.buyer1.provider.getBalance(this.tokenVault.address)
    await this.tokenVault.connect(this.buyer1).withdrawUnsettledBids(this.addr1.address);
    expect(await this.buyer1.provider.getBalance(this.tokenVault.address)).to.be.equal(initialBal.sub(buyoutBidDeposit));
    blockTime = await this.testTWAV.getCurrentBlockTime();

    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());

    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: currentValuation });
    expect(await this.tokenVault.bidder()).to.equal(this.buyer1.address);
    expect(await this.tokenVault.buyoutBid()).to.equal(currentValuation);
    expect(await this.tokenVault.buyoutEndTime()).to.equal(blockTime.add(BUYOUT_DURATION));
  });

  it("Users should be able redeem funds after buyout", async function () {
    let balanceContract = initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;
    blockTime = await this.testTWAV.getCurrentBlockTime();
    let _primaryReserveBalance = primaryReserveBalance;
    const FEE_TOTAL = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);

    let _buyAmount = ethers.utils.parseEther("20");      
    balanceContract = balanceContract.add(_buyAmount.sub(_buyAmount.mul(FEE_ADMIN).div(SCALE)));
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    _primaryReserveBalance = _primaryReserveBalance.add(_buyAmount.sub(_buyAmount.mul(FEE_TOTAL).div(SCALE)));
    await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount }); 
        
    _buyAmount = ethers.utils.parseEther("20");      
    balanceContract = balanceContract.add(_buyAmount.sub(_buyAmount.mul(FEE_ADMIN).div(SCALE)));
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    _primaryReserveBalance = _primaryReserveBalance.add(_buyAmount.sub(_buyAmount.mul(FEE_TOTAL).div(SCALE)));
    await this.tokenVault.connect(this.buyer1).buy(0, this.addr1.address, { value: _buyAmount }); 
    
    _buyAmount = ethers.utils.parseEther("20");      
    balanceContract = balanceContract.add(_buyAmount.sub(_buyAmount.mul(FEE_ADMIN).div(SCALE)));
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    _primaryReserveBalance = _primaryReserveBalance.add(_buyAmount.sub(_buyAmount.mul(FEE_TOTAL).div(SCALE)));
    await this.tokenVault.connect(this.buyer1).buy(0, this.addr1.address, { value: _buyAmount }); 
    
    _buyAmount = ethers.utils.parseEther("20");      
    balanceContract = balanceContract.add(_buyAmount.sub(_buyAmount.mul(FEE_ADMIN).div(SCALE)));
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    _primaryReserveBalance = _primaryReserveBalance.add(_buyAmount.sub(_buyAmount.mul(FEE_TOTAL).div(SCALE)));
    await this.tokenVault.connect(this.buyer1).buy(0, this.addr1.address, { value: _buyAmount }); 
        
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutBidDeposit = BigNumber.from("168880000000000000000");
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    
    // ---------------------Buyout Initiated--------------------------//
    _buyAmount = ethers.utils.parseEther("2");      
    balanceContract = balanceContract.add(buyoutBidDeposit);
    increaseTime(3, "days");
    const balanceBuyer = await this.tokenVault.balanceOf(this.buyer1.address);
    const totalSupply = await this.tokenVault.totalSupply();
    const returnAmt: BigNumber = ((balanceContract.sub(curatorFeeAccrued)).mul(balanceBuyer)).div(totalSupply);
    const initialBalAddr1: BigNumber = await this.admin.provider.getBalance(this.addr1.address);
    await this.tokenVault.connect(this.buyer1).redeem(this.addr1.address); 
    expect(await this.admin.provider.getBalance(this.addr1.address)).to.be.equal(initialBalAddr1.add(returnAmt));
    expect(await this.tokenVault.balanceOf(this.buyer1.address)).to.be.equal(ethers.constants.Zero);
  });



  // it("Tokenholder redeems his tokens before NFT unlock has been triggered by bidder", async function () {
  //   // Buy tokens worth 1 ETH for buyer1
  //   const _buyAmount = ethers.utils.parseEther("1");
  //   await this.tokenVault
  //     .connect(this.buyer1)
  //     .buy(0, this.buyer1.address, { value: _buyAmount });
  //   const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
  //     this.buyer1.address
  //   );
  //   // Buyout initiated by bidder by putting in 200 ETH
  //   const buyoutBidAmount = ethers.utils.parseEther("200");
  //   await this.tokenVault
  //     .connect(this.addr1)
  //     .initiateBuyout({ value: buyoutBidAmount });
  //   const buyoutBid = await this.tokenVault.buyoutBid();
  //   await this.tokenVault
  //     .connect(this.addr1)
  //     .buy(0, this.addr1.address, { value: _buyAmount.mul(5) });
  //   // Time passes and buyout succeeds
  //   await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
  //   const contractBalBeforeRedeem = await this.admin.provider.getBalance(
  //     this.tokenVault.address
  //   );

  //   const totalSupply = await this.tokenVault.totalSupply();
  //   // Tokenholder should get money from the buyout bid in proprtion to the token supply he owns
  //   const expectedETH = tokenBalBeforeRedeem.mul(buyoutBid).div(totalSupply);
  //   // Redeem function triggered
  //   await this.tokenVault.connect(this.buyer1).redeem();
  //   const contractBalAfterRedeem = await this.admin.provider.getBalance(
  //     this.tokenVault.address
  //   );
  //   const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
  //     this.buyer1.address
  //   );
  //   // TODO: Instead of checking contract balance, it might be better to directly check tokenholder balance.
  //   const redeemedAmount = contractBalBeforeRedeem.sub(contractBalAfterRedeem);
  //   expect(tokenBalAfterRedeem).to.be.equal(0);
  //   expect(redeemedAmount).to.be.equal(expectedETH);
  // });
  // it("Redeem-unlock-Redeem", async function () {
  //   const _buyAmount = ethers.utils.parseEther("1");
  //   await this.tokenVault
  //     .connect(this.buyer1)
  //     .buy(0, this.buyer1.address, { value: _buyAmount });
  //   await this.tokenVault
  //     .connect(this.addr2)
  //     .buy(0, this.addr2.address, { value: _buyAmount });
  //   const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
  //     this.buyer1.address
  //   );
  //   const tokenBalBeforeRedeemAddr2 = await this.tokenVault.balanceOf(
  //     this.addr2.address
  //   );
  //   const buyoutBidAmount = ethers.utils.parseEther("200");
  //   await this.tokenVault
  //     .connect(this.addr1)
  //     .initiateBuyout({ value: buyoutBidAmount });
  //   let buyoutBid = await this.tokenVault.buyoutBid();
  //   //more buying to increase vault balance
  //   await this.tokenVault
  //     .connect(this.addr1)
  //     .buy(0, this.addr1.address, { value: _buyAmount.mul(5) }); //5 ETH buy
  //   await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
  //   const contractBalBeforeRedeem = await this.admin.provider.getBalance(
  //     this.tokenVault.address
  //   );

  //   let totalSupply = await this.tokenVault.totalSupply();
  //   const expectedETH = tokenBalBeforeRedeem.mul(buyoutBid).div(totalSupply);
  //   await this.tokenVault.connect(this.buyer1).redeem();
  //   const contractBalAfterRedeem = await this.admin.provider.getBalance(
  //     this.tokenVault.address
  //   );
  //   const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
  //     this.buyer1.address
  //   );
  //   const redeemedAmount = contractBalBeforeRedeem.sub(contractBalAfterRedeem);
  //   expect(tokenBalAfterRedeem).to.be.equal(0);
  //   expect(redeemedAmount).to.be.equal(expectedETH);

  //   buyoutBid = await this.tokenVault.buyoutBid();
  //   await this.tokenVault.connect(this.addr1).unlockNFT(this.addr1.address);
  //   const contractBalAfterUnlock = await this.admin.provider.getBalance(
  //     this.tokenVault.address
  //   );
  //   const curatorFee = await this.tokenVault.feeAccruedCurator();
  //   const expectedRefund = contractBalAfterRedeem.sub(
  //     buyoutBid.add(curatorFee)
  //   );
  //   const refundIssued = contractBalAfterRedeem.sub(contractBalAfterUnlock);
  //   expect(expectedRefund).to.be.equal(refundIssued);

  //   totalSupply = await this.tokenVault.totalSupply();
  //   await this.tokenVault.connect(this.addr2).redeem();

  //   const contractBalAfterRedeemAddr2 = await this.admin.provider.getBalance(
  //     this.tokenVault.address
  //   );
  //   const tokenBalAfterRedeemAddr2 = await this.tokenVault.balanceOf(
  //     this.addr2.address
  //   );
  //   const redeemedAmountAddr2 = contractBalAfterUnlock.sub(
  //     contractBalAfterRedeemAddr2
  //   );
  //   const expectedETHAddr2 = tokenBalBeforeRedeemAddr2
  //     .mul(buyoutBid)
  //     .div(totalSupply);
  //   expect(redeemedAmountAddr2).to.be.equal(expectedETHAddr2);
  //   expect(tokenBalAfterRedeemAddr2).to.be.equal(0);
  // });

  // it("Token redemption in the case where the contract balance becomes less than buyout bid", async function () {
  //   // This case happens when people sell tokens after buyout is triggered, although the incentive for this case happening are very less,
  //   //there is still a possibility.
  //   // Buy tokens worth 1 ETH for buyer1
  //   const _buyAmount = ethers.utils.parseEther("1");
  //   await this.tokenVault
  //     .connect(this.buyer1)
  //     .buy(0, this.buyer1.address, { value: _buyAmount });
  //   const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
  //     this.buyer1.address
  //   );
  //   // Buyout started with a bid of 100 ETH
  //   const buyoutBidAmount = ethers.utils.parseEther("100");
  //   await this.tokenVault
  //     .connect(this.addr1)
  //     .initiateBuyout({ value: buyoutBidAmount });
  //   // Buyout bid value = 10 (reserve balance) + 100 + 0.994 (1 ETH buy order - admin fees - curator fees) = 110.994
  //   const buyoutBid = await this.tokenVault.buyoutBid();

  //   // Selling same # of tokens bought earlier to decrease the contract balance 
  //   // (Note : selling is done from curator address instead of buyer1 address), 110.015 is the new contract balance
  //   //  Contract balance < buyout bid amount in this case
  //   await this.tokenVault
  //     .connect(this.curator)
  //     .sell(tokenBalBeforeRedeem, 0, this.curator.address);
  //   // Time passes and buyout succeeds
  //   await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
  //   const totalSupply = await this.tokenVault.totalSupply();

  //   const contractBalBeforeUnlock = await this.admin.provider.getBalance(
  //     this.tokenVault.address
  //   );
    
  //   await this.tokenVault.connect(this.addr1).unlockNFT(this.addr1.address);
  //   const contractBalAfterUnlock = await this.admin.provider.getBalance(
  //     this.tokenVault.address
  //   );
  //   const refundIssued = contractBalBeforeUnlock.sub(contractBalAfterUnlock);
  //   // Buyout bidder doesn't receive any excess ETH in this case.
  //   expect(refundIssued).to.be.equal(0);

  //   await this.tokenVault.connect(this.buyer1).redeem();
  //   const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
  //     this.buyer1.address
  //   );
  //   // After a successful redemption, token balance becomes 0
  //   expect(tokenBalAfterRedeem).to.be.equal(0);
  //   const curatorFee = await this.tokenVault.feeAccruedCurator();
  //   const contractBalAfterRedeem = await this.admin.provider.getBalance(
  //     this.tokenVault.address
  //   );
  //   const redeemedAmount = contractBalAfterUnlock.sub(contractBalAfterRedeem);
  //   // redeemed Amount = tokenBalance * (contractBalance - feeAccruedCurator)/ totalSupply
  //   // Buyer1 will get more ETH than he put in as someone sold below the current valuation
  //   const expectedETH = tokenBalBeforeRedeem
  //     .mul(contractBalAfterUnlock.sub(curatorFee))
  //     .div(totalSupply);
    
  //   expect(redeemedAmount).to.be.equal(expectedETH);
  // });

  // it(" Mint/Burn stops after success", async function () {
  //   const _buyAmount = ethers.utils.parseEther("1");
  //   const buyoutBid = ethers.utils.parseEther("200");
  //   this.tokenVault
  //     .connect(this.buyer1)
  //     .buy(0, this.buyer1.address, { value: _buyAmount });
  //   await this.tokenVault
  //     .connect(this.buyer1)
  //     .initiateBuyout({ value: buyoutBid });
  //   await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60]);
  //   await expect(
  //     this.tokenVault
  //       .connect(this.buyer1)
  //       .buy(0, this.buyer1.address, { value: _buyAmount })
  //   ).to.revertedWith("NFT has been bought");
  //   await expect(
  //     this.tokenVault
  //       .connect(this.buyer1)
  //       .sell(_buyAmount, 0, this.buyer1.address)
  //   ).to.revertedWith("NFT has been bought");
  // });
  // it("No more buyout bids possible", async function () {
  //   const buyoutBid = ethers.utils.parseEther("200");
  //   await this.tokenVault
  //     .connect(this.buyer1)
  //     .initiateBuyout({ value: buyoutBid });
  //   await expect(
  //     this.tokenVault.connect(this.addr1).initiateBuyout({ value: buyoutBid })
  //   ).to.revertedWith("NibblVault: Only when initialised");
  // });
  // it("Buyout rejects automatically when twav>=buyoutrejectionvaluation within 3 days", async function () {
  //   const _buyAmount = ethers.utils.parseEther("1");
  //   //Filling the TWAV array
  //   for (let i = 0; i < 12; i++) {
  //     this.tokenVault
  //       .connect(this.addr1)
  //       .buy(0, this.buyer1.address, { value: _buyAmount });
  //   }
  //   const weightedValuation = await this.tokenVault._getTwav();
  //   const bidAmount = weightedValuation;
  //   await this.tokenVault
  //     .connect(this.buyer1)
  //     .initiateBuyout({ value: bidAmount });
  //   let buyoutRejectionValuation =
  //     await this.tokenVault.buyoutRejectionValuation();
  //   const buyAmountToReject = buyoutRejectionValuation.sub(weightedValuation);
  //   const balanceBeforeRejection = await this.admin.provider.getBalance(
  //     this.buyer1.address
  //   );
  //   this.tokenVault
  //     .connect(this.addr1)
  //     .buy(0, this.addr1.address, { value: buyAmountToReject });
  //   for (let i = 0; i < 12; i++) {
  //     this.tokenVault
  //       .connect(this.addr1)
  //       .buy(0, this.addr1.address, { value: _buyAmount });
  //     let valuationAfterOrder = await this.tokenVault._getTwav();
  //     const status = await this.tokenVault.status();
  //     if (valuationAfterOrder > buyoutRejectionValuation) {
  //       expect(status).to.be.equal(0);
  //     } else {
  //       expect(status).to.be.equal(1);
  //     }
  //   }
  //   const balanceAfterRejection = await this.admin.provider.getBalance(
  //     this.buyer1.address
  //   );
  //   expect(balanceAfterRejection).to.be.equal(
  //     balanceBeforeRejection.add(bidAmount)
  //   );
  //   //Mint Works after rejection

  //   await this.tokenVault
  //     .connect(this.buyer1)
  //     .buy(0, this.buyer1.address, { value: _buyAmount });
  //   await this.tokenVault
  //     .connect(this.buyer1)
  //     .sell(_buyAmount, 0, this.buyer1.address);
  // });
  // it("Buyout bid is rejected if the valuation is low", async function () {
  //   const buyoutBid = ethers.utils.parseEther("1");
  //   await expect(
  //     this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBid })
  //   ).to.revertedWith("NibblVault: Bid too low");
  // });
});