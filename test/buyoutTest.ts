import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import {
  mintTokens,
  burnTokens,
} from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime } from "./testHelpers/time";

describe("NibblTokenVault", function () {
  type TwavObservation = {
    timestamp: BigNumber;
    cumulativeValuation: BigNumber;
  };
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e6);
  const ONE = BigNumber.from(1);
  const decimal = BigNumber.from((1e18).toString());

  const FEE_ADMIN: BigNumber = BigNumber.from(2000);
  const FEE_CURATOR: BigNumber = BigNumber.from(4000);
  const FEE_CURVE: BigNumber = BigNumber.from(4000);

  const MAX_FEE_ADMIN: BigNumber = BigNumber.from(2000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4000);
  const MAX_FEE_CURVE: BigNumber = BigNumber.from(4000);
  const rejectionPremium: BigNumber = BigNumber.from(100000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500000);

  const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
  const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
  const initialTokenSupply: BigNumber = initialValuation
    .div(initialTokenPrice)
    .mul(decimal);
  const initialSecondaryReserveBalance: BigNumber =
    ethers.utils.parseEther("10");
  const requiredReserveBalance: BigNumber = primaryReserveRatio
    .mul(initialValuation)
    .div(SCALE);
  const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance
    .mul(SCALE)
    .div(initialValuation);
  const primaryReserveBalance: BigNumber = primaryReserveRatio
    .mul(initialValuation)
    .div(SCALE);
  const fictitiousPrimaryReserveBalance = primaryReserveRatio
    .mul(initialValuation)
    .div(SCALE);

  // (primaryReserveRatio * initialTokenSupply * INITIAL_TOKEN_PRICE) / (SCALE * 1e18);

  beforeEach(async function () {
    const [curator, admin, buyer1, addr1, addr2, addr3, addr4] =
      await ethers.getSigners();
    this.curator = curator;
    this.admin = admin;
    this.buyer1 = buyer1;
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

    this.NibblVaultFactory = await ethers.getContractFactory(
      "NibblVaultFactory"
    );
    this.tokenVaultFactory = await this.NibblVaultFactory.deploy(
      this.nibblVaultImplementation.address,
      this.admin.address
    );
    await this.tokenVaultFactory.deployed();
    this.nft.approve(this.tokenVaultFactory.address, 0);

    this.TestBancorBondingCurve = await ethers.getContractFactory(
      "TestBancorBondingCurve"
    );
    this.TestTWAPContract = await ethers.getContractFactory("TestTwav");
    this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
    this.testTWAV = await this.TestTWAPContract.deploy();
    await this.testTWAV.deployed();
    await this.testBancorBondingCurve.deployed();

    await this.tokenVaultFactory.createVault(
      this.nft.address,
      0,
      tokenName,
      tokenSymbol,
      initialTokenSupply,
      10 ** 14,
      MAX_FEE_CURATOR,
      { value: initialSecondaryReserveBalance }
    );
    const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
    this.tokenVault = new ethers.Contract(
      proxyAddress.toString(),
      this.NibblVault.interface,
      this.curator
    );
  });
  it("Buyout succeeds when time passes and twav<buyoutrejectionvaluation throughout the 3 days", async function () {
    const buyoutBid = ethers.utils.parseEther("200");
    await this.tokenVault
      .connect(this.buyer1)
      .initiateBuyOut({ value: buyoutBid });
    await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
    await this.tokenVault.connect(this.buyer1).unlockNFT(this.buyer1.address);
  });
  it("Token holder is able to redeem tokens for ETH in proportion to the supply they own", async function () {
    const _buyAmount = ethers.utils.parseEther("1");
    await this.tokenVault
      .connect(this.buyer1)
      .buy(0, this.buyer1.address, { value: _buyAmount });
    const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    const totalSupply = await this.tokenVault.totalSupply();
    const ethBalBeforeRedeem = await this.admin.provider.getBalance(
      this.buyer1.address
    );
    const buyoutBid = ethers.utils.parseEther("200");
    await this.tokenVault
      .connect(this.addr1)
      .initiateBuyOut({ value: buyoutBid });
    await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
    await this.tokenVault.connect(this.addr1).unlockNFT(this.addr1.address);
    const contractBalBeforeRedeem = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    const expectedETH = tokenBalBeforeRedeem*(contractBalBeforeRedeem)/totalSupply
    await this.tokenVault.connect(this.buyer1).redeem();
    const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    const ethBalAfterRedeem = await this.admin.provider.getBalance(
      this.buyer1.address
    );
    expect(tokenBalAfterRedeem).to.be.equal(0);
    console.log(ethBalAfterRedeem.sub(ethBalBeforeRedeem).toString());
    console.log(expectedETH)
  });
  it(" Mint/Burn stops after success", async function () {
    const _buyAmount = ethers.utils.parseEther("1");
    const buyoutBid = ethers.utils.parseEther("200");
    this.tokenVault
      .connect(this.buyer1)
      .buy(0, this.buyer1.address, { value: _buyAmount });
    await this.tokenVault
      .connect(this.buyer1)
      .initiateBuyOut({ value: buyoutBid });
    await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60]);
    await expect(
      this.tokenVault
        .connect(this.buyer1)
        .buy(0, this.buyer1.address, { value: _buyAmount })
    ).to.revertedWith("NFT has been bought");
    await expect(
      this.tokenVault
        .connect(this.buyer1)
        .sell(_buyAmount, 0, this.buyer1.address)
    ).to.revertedWith("NFT has been bought");
  });
  it("No more buyout bids possible", async function () {
    const buyoutBid = ethers.utils.parseEther("200");
    await this.tokenVault
      .connect(this.buyer1)
      .initiateBuyOut({ value: buyoutBid });
    await expect(
      this.tokenVault.connect(this.addr1).initiateBuyOut({ value: buyoutBid })
    ).to.revertedWith("NibblVault: Only when initialised");
  });
  it("Buyout rejects automatically when twav>=buyoutrejectionvaluation within 3 days", async function () {
    const _buyAmount = ethers.utils.parseEther("1");
    //Filling the TWAV array
    for (let i = 0; i < 12; i++) {
      this.tokenVault
        .connect(this.addr1)
        .buy(0, this.buyer1.address, { value: _buyAmount });
    }
    const weightedValuation = await this.tokenVault._getTwav();
    const bidAmount = weightedValuation;
    await this.tokenVault
      .connect(this.buyer1)
      .initiateBuyOut({ value: bidAmount });
    let buyoutRejectionValuation =
      await this.tokenVault.buyoutRejectionValuation();
    const buyAmountToReject = buyoutRejectionValuation.sub(weightedValuation);
    const balanceBeforeRejection = await this.admin.provider.getBalance(
      this.buyer1.address
    );
    this.tokenVault
      .connect(this.addr1)
      .buy(0, this.addr1.address, { value: buyAmountToReject });
    for (let i = 0; i < 12; i++) {
      this.tokenVault
        .connect(this.addr1)
        .buy(0, this.addr1.address, { value: _buyAmount });
      let valuationAfterOrder = await this.tokenVault._getTwav();
      const status = await this.tokenVault.status();
      if (valuationAfterOrder > buyoutRejectionValuation) {
        expect(status).to.be.equal(0);
      } else {
        expect(status).to.be.equal(1);
      }
    }
    const balanceAfterRejection = await this.admin.provider.getBalance(
      this.buyer1.address
    );
    expect(balanceAfterRejection).to.be.equal(
      balanceBeforeRejection.add(bidAmount)
    );
    //Mint Works after rejection
    await this.tokenVault
      .connect(this.buyer1)
      .buy(0, this.buyer1.address, { value: _buyAmount });
  });
  it("Buyout bid is rejected if the valuation is low", async function () {
    const buyoutBid = ethers.utils.parseEther("1");
    await expect(
      this.tokenVault.connect(this.buyer1).initiateBuyOut({ value: buyoutBid })
    ).to.revertedWith("NibblVault: Low buyout valuation");
  });
});
