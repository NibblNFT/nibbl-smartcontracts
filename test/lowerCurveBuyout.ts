import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { mintTokens, burnTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime , increaseTime } from "./testHelpers/time";
import { TWAV } from "./testHelpers/twavHelper";

describe("Lower Curve Buyout", function () {
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e9);
  const ONE = BigNumber.from(1);
  const ZERO = BigNumber.from(0);
  const decimal = BigNumber.from((1e18).toString());
  const FEE_ADMIN: BigNumber = BigNumber.from(2_000_000);
  const FEE_CURATOR: BigNumber = BigNumber.from(4_000_000);
  const FEE_CURVE: BigNumber = BigNumber.from(4_000_000);
  
  const MAX_FEE_ADMIN: BigNumber = BigNumber.from(2_000_000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4_000_000);
  const MAX_FEE_CURVE: BigNumber = BigNumber.from(4_000_000);
  const rejectionPremium: BigNumber = BigNumber.from(100_000_000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500_000_000);
  
  const THREE_MINS: BigNumber = BigNumber.from(180)
  const BUYOUT_DURATION: BigNumber = BigNumber.from(3 * 24 * 60 * 60); 
  let blockTime: BigNumber;
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
    blockTime = await this.testTWAV.getCurrentBlockTime();
  });

    
it("Should initiate buyout in lower curve on exact amount.", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const _sellAmount = initialTokenSupply.div(5);
    const _expectedSaleReturn = await burnTokens(this.testBancorBondingCurve, initialTokenSupply, initialSecondaryReserveBalance, initialSecondaryReserveRatio, _sellAmount);        
    await this.tokenVault.connect(this.curator).sell(_sellAmount, _expectedSaleReturn, this.addr1.address);
    const currentValuation = ((initialSecondaryReserveBalance.sub(_expectedSaleReturn)).mul(SCALE).div(initialSecondaryReserveRatio));
    expect(await this.tokenVault.secondaryReserveBalance()).to.equal(initialSecondaryReserveBalance.sub(_expectedSaleReturn));
    expect(await this.tokenVault.totalSupply()).to.equal(initialTokenSupply.sub(_sellAmount));
    let twavObs = await this.tokenVault.twavObservations(0)
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[0].cumulativeValuation);
    // -----------------Tokens Sold ---------------------------- //
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
    const buyoutValuationDeposit: BigNumber = currentValuation.sub((primaryReserveBalance.sub(fictitiousPrimaryReserveBalance))).sub((initialSecondaryReserveBalance.sub(_expectedSaleReturn)));
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutValuationDeposit }); //Value = exact amount required
    expect(await this.tokenVault.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);    
    expect(await this.tokenVault.buyoutValuationDeposit()).to.equal(buyoutValuationDeposit);
    expect(await this.tokenVault.bidder()).to.equal(this.buyer1.address);
    expect(await this.tokenVault.buyoutEndTime()).to.equal(blockTime.add(BUYOUT_DURATION));
    expect(await this.tokenVault.status()).to.equal(ethers.constants.One);
    twavObs = await this.tokenVault.twavObservations(1)
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[1].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[1].cumulativeValuation);
});

it("Should initiate buyout in lower curve on higher amount.", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const _sellAmount = initialTokenSupply.div(5);
    const _expectedSaleReturn = await burnTokens(this.testBancorBondingCurve, initialTokenSupply, initialSecondaryReserveBalance, initialSecondaryReserveRatio, _sellAmount);        
    await this.tokenVault.connect(this.curator).sell(_sellAmount, _expectedSaleReturn, this.addr1.address);
    const currentValuation = ((initialSecondaryReserveBalance.sub(_expectedSaleReturn)).mul(SCALE).div(initialSecondaryReserveRatio));
    expect(await this.tokenVault.secondaryReserveBalance()).to.equal(initialSecondaryReserveBalance.sub(_expectedSaleReturn));
    expect(await this.tokenVault.totalSupply()).to.equal(initialTokenSupply.sub(_sellAmount));
    let twavObs = await this.tokenVault.twavObservations(0)
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[0].cumulativeValuation);
    // -----------------Tokens Sold ---------------------------- //
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
    const buyoutValuationDeposit: BigNumber = currentValuation.sub((primaryReserveBalance.sub(fictitiousPrimaryReserveBalance))).sub((initialSecondaryReserveBalance.sub(_expectedSaleReturn)));
    this.twav.addObservation(currentValuation, blockTime);    
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: currentValuation }); //Value = exact amount required
    expect(await this.tokenVault.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);    
    expect(await this.tokenVault.buyoutValuationDeposit()).to.equal(buyoutValuationDeposit);
    expect(await this.tokenVault.bidder()).to.equal(this.buyer1.address);
    expect(await this.tokenVault.buyoutEndTime()).to.equal(blockTime.add(BUYOUT_DURATION));
    expect(await this.tokenVault.status()).to.equal(ethers.constants.One);
    twavObs = await this.tokenVault.twavObservations(1)
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[1].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[1].cumulativeValuation);
});
  
  it("Should reject buyout", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const _sellAmount = initialTokenSupply.div(5);
    const _expectedSaleReturn = await burnTokens(this.testBancorBondingCurve, initialTokenSupply, initialSecondaryReserveBalance, initialSecondaryReserveRatio, _sellAmount);        
    await this.tokenVault.connect(this.curator).sell(_sellAmount, _expectedSaleReturn, this.addr1.address);
    let currentValuation = ((initialSecondaryReserveBalance.sub(_expectedSaleReturn)).mul(SCALE).div(initialSecondaryReserveRatio));
    expect(await this.tokenVault.secondaryReserveBalance()).to.equal(initialSecondaryReserveBalance.sub(_expectedSaleReturn));
    expect(await this.tokenVault.totalSupply()).to.equal(initialTokenSupply.sub(_sellAmount));
    // -----------------Tokens Sold ---------------------------- //
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance.sub(_expectedSaleReturn));
    const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    const twavObs = await this.tokenVault.twavObservations(0);
    expect(twavObs.timestamp).to.equal(this.twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(this.twav.twavObservations[0].cumulativeValuation);
    // -------------------------Buyout Initiated--------------------------
    for (let index = 0; true; index++) {
      blockTime = blockTime.add(THREE_MINS);
      await setTime(blockTime.toNumber());
      const _buyAmount = ethers.utils.parseEther(".01");
      const _initialSecondaryBalance = await this.tokenVault.secondaryReserveBalance();
      this.twav.addObservation(currentValuation, blockTime);
      await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
      currentValuation = ((_initialSecondaryBalance.add(_buyAmount)).mul(SCALE)).div(initialSecondaryReserveRatio)
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
});
