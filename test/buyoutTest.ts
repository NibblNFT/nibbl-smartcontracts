import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import {
  mintTokens,
  burnTokens,
} from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime } from "./testHelpers/time";

describe("Buyout", function () {
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
    const owner = await this.nft.ownerOf(0);
    expect(owner).to.be.equal(this.buyer1.address);
  });

  it("When after buyout in surplus condition Token holder is able to redeem tokens for ETH in proportion to the supply they own", async function () {
    const _buyAmount = ethers.utils.parseEther("1");
    await this.tokenVault
      .connect(this.buyer1)
      .buy(0, this.buyer1.address, { value: _buyAmount });
    const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    const buyoutBidAmount = ethers.utils.parseEther("200");
    await this.tokenVault
      .connect(this.addr1)
      .initiateBuyOut({ value: buyoutBidAmount });
    const buyoutBid = await this.tokenVault.buyoutBid();
    //more buying to increase vault balance
    await this.tokenVault
      .connect(this.addr1)
      .buy(0, this.addr1.address, { value: _buyAmount.mul(5) }); //5 ETH buy
    await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);

    const contractBalBeforeUnlock = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    await this.tokenVault.connect(this.addr1).unlockNFT(this.addr1.address);

    const curatorFee = await this.tokenVault.feeAccruedCurator();
    const contractBalBeforeRedeem = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    const expectedRefund = contractBalBeforeUnlock.sub(
      buyoutBid.add(curatorFee)
    );
    const refundIssued = contractBalBeforeUnlock.sub(contractBalBeforeRedeem);
    expect(expectedRefund).to.be.equal(refundIssued);

    const totalSupply = await this.tokenVault.totalSupply();
    const expectedETH = tokenBalBeforeRedeem.mul(buyoutBid).div(totalSupply);
    await this.tokenVault.connect(this.buyer1).redeem();
    const contractBalAfterRedeem = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    const redeemedAmount = contractBalBeforeRedeem.sub(contractBalAfterRedeem);
    expect(tokenBalAfterRedeem).to.be.equal(0);
    expect(redeemedAmount).to.be.equal(expectedETH);
  });

  it("Redeeming before unlocking", async function () {
    const _buyAmount = ethers.utils.parseEther("1");
    await this.tokenVault
      .connect(this.buyer1)
      .buy(0, this.buyer1.address, { value: _buyAmount });
    const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    const buyoutBidAmount = ethers.utils.parseEther("200");
    await this.tokenVault
      .connect(this.addr1)
      .initiateBuyOut({ value: buyoutBidAmount });
    const buyoutBid = await this.tokenVault.buyoutBid();
    //more buying to increase vault balance
    await this.tokenVault
      .connect(this.addr1)
      .buy(0, this.addr1.address, { value: _buyAmount.mul(5) }); //5 ETH buy
    await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
    const contractBalBeforeRedeem = await this.admin.provider.getBalance(
      this.tokenVault.address
    );

    const totalSupply = await this.tokenVault.totalSupply();
    const expectedETH = tokenBalBeforeRedeem.mul(buyoutBid).div(totalSupply);
    await this.tokenVault.connect(this.buyer1).redeem();
    const contractBalAfterRedeem = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    const redeemedAmount = contractBalBeforeRedeem.sub(contractBalAfterRedeem);
    expect(tokenBalAfterRedeem).to.be.equal(0);
    expect(redeemedAmount).to.be.equal(expectedETH);
  });
  it("Redeem-unlock-Redeem", async function () {
    const _buyAmount = ethers.utils.parseEther("1");
    await this.tokenVault
      .connect(this.buyer1)
      .buy(0, this.buyer1.address, { value: _buyAmount });
    await this.tokenVault
      .connect(this.addr2)
      .buy(0, this.addr2.address, { value: _buyAmount });
    const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    const tokenBalBeforeRedeemAddr2 = await this.tokenVault.balanceOf(
      this.addr2.address
    );
    const buyoutBidAmount = ethers.utils.parseEther("200");
    await this.tokenVault
      .connect(this.addr1)
      .initiateBuyOut({ value: buyoutBidAmount });
    let buyoutBid = await this.tokenVault.buyoutBid();
    //more buying to increase vault balance
    await this.tokenVault
      .connect(this.addr1)
      .buy(0, this.addr1.address, { value: _buyAmount.mul(5) }); //5 ETH buy
    await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
    const contractBalBeforeRedeem = await this.admin.provider.getBalance(
      this.tokenVault.address
    );

    let totalSupply = await this.tokenVault.totalSupply();
    const expectedETH = tokenBalBeforeRedeem.mul(buyoutBid).div(totalSupply);
    await this.tokenVault.connect(this.buyer1).redeem();
    const contractBalAfterRedeem = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    const redeemedAmount = contractBalBeforeRedeem.sub(contractBalAfterRedeem);
    expect(tokenBalAfterRedeem).to.be.equal(0);
    expect(redeemedAmount).to.be.equal(expectedETH);

    buyoutBid = await this.tokenVault.buyoutBid();
    await this.tokenVault.connect(this.addr1).unlockNFT(this.addr1.address);
    const contractBalAfterUnlock = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    const curatorFee = await this.tokenVault.feeAccruedCurator();
    const expectedRefund = contractBalAfterRedeem.sub(
      buyoutBid.add(curatorFee)
    );
    const refundIssued = contractBalAfterRedeem.sub(contractBalAfterUnlock);
    expect(expectedRefund).to.be.equal(refundIssued);

    totalSupply = await this.tokenVault.totalSupply();
    await this.tokenVault.connect(this.addr2).redeem();

    const contractBalAfterRedeemAddr2 = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    const tokenBalAfterRedeemAddr2 = await this.tokenVault.balanceOf(
      this.addr2.address
    );
    const redeemedAmountAddr2 = contractBalAfterUnlock.sub(
      contractBalAfterRedeemAddr2
    );
    const expectedETHAddr2 = tokenBalBeforeRedeemAddr2
      .mul(buyoutBid)
      .div(totalSupply);
    expect(redeemedAmountAddr2).to.be.equal(expectedETHAddr2);
    expect(tokenBalAfterRedeemAddr2).to.be.equal(0);
  });

  it("When after buyout in deficit condition Token holder is able to redeem tokens for ETH in proportion to the supply they own", async function () {
    //Buying some tokens to sell later
    const _buyAmount = ethers.utils.parseEther("1");
    await this.tokenVault
      .connect(this.buyer1)
      .buy(0, this.buyer1.address, { value: _buyAmount });
    const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    const buyoutBidAmount = ethers.utils.parseEther("100");
    await this.tokenVault
      .connect(this.addr1)
      .initiateBuyOut({ value: buyoutBidAmount });
    const buyoutBid = await this.tokenVault.buyoutBid();
    //selling tokens to decrease the contract balance
    await this.tokenVault
      .connect(this.curator)
      .sell(tokenBalBeforeRedeem, 0, this.curator.address);
    await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
    const totalSupply = await this.tokenVault.totalSupply();
    const contractBalBeforeUnlock = await this.admin.provider.getBalance(
      this.tokenVault.address
    );

    await this.tokenVault.connect(this.addr1).unlockNFT(this.addr1.address);
    const contractBalBeforeRedeem = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    const refundIssued = contractBalBeforeUnlock.sub(contractBalBeforeRedeem);
    expect(refundIssued).to.be.equal(0);

    await this.tokenVault.connect(this.buyer1).redeem();
    const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
      this.buyer1.address
    );
    expect(tokenBalAfterRedeem).to.be.equal(0);
    const curatorFee = await this.tokenVault.feeAccruedCurator();
    const contractBalAfterRedeem = await this.admin.provider.getBalance(
      this.tokenVault.address
    );
    const redeemedAmount = contractBalBeforeRedeem.sub(contractBalAfterRedeem);
    const expectedETH = tokenBalBeforeRedeem
      .mul(contractBalBeforeRedeem.sub(curatorFee))
      .div(totalSupply);
    expect(redeemedAmount).to.be.equal(expectedETH);
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
    await this.tokenVault
      .connect(this.buyer1)
      .sell(_buyAmount, 0, this.buyer1.address);
  });
  it("Buyout bid is rejected if the valuation is low", async function () {
    const buyoutBid = ethers.utils.parseEther("1");
    await expect(
      this.tokenVault.connect(this.buyer1).initiateBuyOut({ value: buyoutBid })
    ).to.revertedWith("NibblVault: Low buyout valuation");
  });
});
