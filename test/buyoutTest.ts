import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { mintTokens, burnTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime , increaseTime } from "./testHelpers/time";
import { TWAV } from "./testHelpers/twavHelper";

describe("Buyout", function () {
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e6);
  const decimal = BigNumber.from((1e18).toString());
  const FEE_ADMIN: BigNumber = BigNumber.from(2_000);
  const FEE_CURATOR: BigNumber = BigNumber.from(4_000);
  const FEE_CURVE: BigNumber = BigNumber.from(4_000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4_000);
  const rejectionPremium: BigNumber = BigNumber.from(100_000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500_000);
  const BUYOUT_DURATION: BigNumber = BigNumber.from(3 * 24 * 60 * 60);   
  const THREE_MINS: BigNumber = BigNumber.from(180)
  let blockTime: BigNumber = BigNumber.from(Math.ceil((Date.now() / 1e3)));
  const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
  const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
  const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
  const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
  const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
  const primaryReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const fictitiousPrimaryReserveBalance = primaryReserveRatio.mul(initialValuation).div(SCALE);

  beforeEach(async function () {
    const [curator, admin, buyer1, buyer2, addr1, implementerRole, feeRole, pauserRole] = await ethers.getSigners();
    this.curator = curator;
    this.admin = admin;
    this.buyer1 = buyer1;
    this.buyer2 = buyer2;
    this.addr1 = addr1;
    this.implementerRole = implementerRole;
    this.feeRole = feeRole;
    this.pauserRole = pauserRole;

    this.NFT = await ethers.getContractFactory("NFT");
    this.nft = await this.NFT.deploy();
    await this.nft.deployed();
    
    await this.nft.mint(this.curator.address, 0);

    this.NibblVault = await ethers.getContractFactory("NibblVault");
    this.nibblVaultImplementation = await this.NibblVault.deploy();
    await this.nibblVaultImplementation.deployed();
// Basket
    this.Basket = await ethers.getContractFactory("Basket");
    this.basketImplementation = await this.Basket.deploy();
    await this.basketImplementation.deployed();

    this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    this.tokenVaultFactory = await this.NibblVaultFactory.connect(this.curator).deploy(this.nibblVaultImplementation.address, this.basketImplementation.address, this.admin.address, this.admin.address); 
    await this.tokenVaultFactory.deployed();
    await this.tokenVaultFactory.connect(this.admin).grantRole(await this.tokenVaultFactory.FEE_ROLE(), this.feeRole.address);
    await this.tokenVaultFactory.connect(this.admin).grantRole(await this.tokenVaultFactory.PAUSER_ROLE(), this.pauserRole.address);
    await this.tokenVaultFactory.connect(this.admin).grantRole(await this.tokenVaultFactory.IMPLEMENTER_ROLE(), this.implementerRole.address);
    await this.nft.approve(this.tokenVaultFactory.address, 0);

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
    await expect(this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount })).to.be.revertedWith("NibblVault: Bought Out");
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
    await expect(this.tokenVault.connect(this.curator).sell(_sellAmount, 0, this.addr1.address)).to.be.revertedWith("NibblVault: Bought Out");
  });

  it("Shouldn't be able to initiate buyout with buyout already going on", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    let currentValuation: BigNumber = initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await expect(this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit })).to.be.revertedWith("NibblVault: Status!=Initialised");
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

  it("Winner should be able to withdraw the locked NFT", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    const FEE_TOTAL = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);

    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    increaseTime(3, "days");
    // ---------------------Buyout Finished--------------------------//
    //withdrawNFT(address _assetAddress, address _to, uint256 _assetID)

    await this.tokenVault.connect(this.buyer1).withdrawERC721(await this.tokenVault.assetAddress(), await this.tokenVault.assetID(), this.addr1.address);
    expect(await this.nft.ownerOf(0)).to.be.equal(this.addr1.address);
  });

  it("Winner should be able to withdraw multiple the locked NFT", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    increaseTime(3, "days");
    // ---------------------Buyout Finished--------------------------//
    this.nft.mint(this.tokenVault.address, 1);
    this.nft.mint(this.tokenVault.address, 2);
    let _assetAddresses = [], _assetIDs = [];
    for (let i = 0; i < 3; i++) {
      _assetAddresses.push(this.nft.address);
      _assetIDs.push(i);
    }
    await this.tokenVault.connect(this.buyer1).withdrawMultipleERC721(_assetAddresses, _assetIDs, this.addr1.address);
    expect(await this.nft.ownerOf(0)).to.be.equal(this.addr1.address);
    expect(await this.nft.ownerOf(1)).to.be.equal(this.addr1.address);
    expect(await this.nft.ownerOf(2)).to.be.equal(this.addr1.address);
  });

  it("Winner should be able to withdraw locked ERC20s", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    this.ERC20Token = await ethers.getContractFactory("ERC20Token");
    this.erc20 = await this.ERC20Token.deploy();
    await this.erc20.deployed();
    await this.erc20.mint(this.tokenVault.address, amount);

    increaseTime(3, "days");
    // ---------------------Buyout Finished--------------------------//

    await this.tokenVault.connect(this.buyer1).withdrawERC20(this.erc20.address, this.addr1.address);
    expect(await this.erc20.balanceOf(this.addr1.address)).to.be.equal(amount);
   });

  
  it("Winner should be able to withdraw locked ERC20s", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    
    this.ERC20Token = await ethers.getContractFactory("ERC20Token");
    this.erc20a = await this.ERC20Token.deploy();
    await this.erc20a.deployed();
    await this.erc20a.mint(this.tokenVault.address, amount);
    this.erc20b = await this.ERC20Token.deploy();
    await this.erc20b.deployed();
    await this.erc20b.mint(this.tokenVault.address, amount);
    
    increaseTime(3, "days");
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [];
    _assetAddresses.push(this.erc20a.address, this.erc20b.address);
    
    await this.tokenVault.connect(this.buyer1).withdrawMultipleERC20(_assetAddresses, this.addr1.address);
    expect(await this.erc20a.balanceOf(this.addr1.address)).to.be.equal(amount);
    expect(await this.erc20b.balanceOf(this.addr1.address)).to.be.equal(amount);
  });


  it("Winner should be able to withdraw locked ERC1155s", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    this.ERC1155Token = await ethers.getContractFactory("ERC1155Token");
    this.erc1155 = await this.ERC1155Token.deploy();
    await this.erc1155.deployed();
    await this.erc1155.mint(this.tokenVault.address, 0, amount);
    
    increaseTime(3, "days");
    // ---------------------Buyout Finished--------------------------//
    // let _assetAddresses = [];
    // _assetAddresses.push(this.erc20a.address, this.erc20b.address);
    
    await this.tokenVault.connect(this.buyer1).withdrawERC1155(this.erc1155.address, 0, this.addr1.address);
    expect(await this.erc1155.balanceOf(this.addr1.address, 0)).to.be.equal(amount);
  });

    it("Winner should be able to withdraw multiple locked ERC1155s", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    this.ERC1155Token = await ethers.getContractFactory("ERC1155Token");
    this.erc1155 = await this.ERC1155Token.deploy();
    await this.erc1155.deployed();
    await this.erc1155.mint(this.tokenVault.address, 0, amount);
    await this.erc1155.mint(this.tokenVault.address, 1, amount);
    
    increaseTime(3, "days");
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [], _assetIDs = [0, 1];
    _assetAddresses.push(this.erc1155.address, this.erc1155.address);
    
    await this.tokenVault.connect(this.buyer1).withdrawMultipleERC1155(_assetAddresses, _assetIDs, this.addr1.address);
    expect(await this.erc1155.balanceOf(this.addr1.address, 0)).to.be.equal(amount);
    expect(await this.erc1155.balanceOf(this.addr1.address, 1)).to.be.equal(amount);
  });
});