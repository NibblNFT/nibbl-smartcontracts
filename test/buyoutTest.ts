import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import { mintTokens, burnTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime , increaseTime } from "./testHelpers/time";
import { TWAV } from "./testHelpers/twavHelper";

describe("Buyout", function () {
  type TwavObservation = {
    timestamp: BigNumber;
    cumulativeValuation: BigNumber;
  };
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e6);
  const ONE = BigNumber.from(1);
  const ZERO = BigNumber.from(0);
  const decimal = BigNumber.from((1e18).toString());

  const FEE_ADMIN: BigNumber = BigNumber.from(2000);
  const FEE_CURATOR: BigNumber = BigNumber.from(4000);
  const FEE_CURVE: BigNumber = BigNumber.from(4000);
  const BUYOUT_DURATION: BigNumber = BigNumber.from(3 * 24 * 60 * 60); 
  
  const MAX_FEE_ADMIN: BigNumber = BigNumber.from(2000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4000);
  const MAX_FEE_CURVE: BigNumber = BigNumber.from(4000);
  const THREE_MINS: BigNumber = BigNumber.from(180)
  const rejectionPremium: BigNumber = BigNumber.from(100000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500000);
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

    this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    this.tokenVaultFactory = await this.NibblVaultFactory.deploy(this.nibblVaultImplementation.address, this.admin.address);
    await this.tokenVaultFactory.deployed();
    this.nft.approve(this.tokenVaultFactory.address, 0);

    this.TestBancorBondingCurve = await ethers.getContractFactory("TestBancorBondingCurve");
    this.TestTWAPContract = await ethers.getContractFactory("TestTwav");
    this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
    this.testTWAV = await this.TestTWAPContract.deploy();
    await this.testTWAV.deployed();
    await this.testBancorBondingCurve.deployed();

    await this.tokenVaultFactory.createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply, 10 ** 14, MAX_FEE_CURATOR, { value: initialSecondaryReserveBalance });
    const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
    this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.NibblVault.interface, this.curator);
    this.twav = new TWAV();
  });

  it("Should initiate buyout when bid == currentValuation", async function () {
    blockTime = BigNumber.from(Math.ceil((Date.now() / 1e3)));
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const currentValuation: BigNumber = initialValuation;
    const initialTokenVaultBalance: BigNumber = await this.buyer1.provider.getBalance(this.tokenVault.address);
    const buyoutRejectionValuation: BigNumber = currentValuation.mul(SCALE.add(rejectionPremium)).div(SCALE);
    const buyoutBidDeposit: BigNumber = currentValuation.sub(primaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).sub(initialSecondaryReserveBalance);
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBidDeposit });
    expect(await this.tokenVault.buyoutBid()).to.equal(currentValuation);
    expect(await this.tokenVault.bidder()).to.equal(this.buyer1.address);
    expect(await this.tokenVault.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);
    expect(await this.tokenVault.status()).to.equal(1);
    expect(await this.tokenVault.buyoutEndTime()).to.equal(blockTime.add(BUYOUT_DURATION));
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
    expect(await this.tokenVault.buyoutBid()).to.equal(currentValuation);
    expect(await this.tokenVault.bidder()).to.equal(this.buyer1.address);
    expect(await this.tokenVault.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);
    expect(await this.tokenVault.status()).to.equal(1);
    expect(await this.buyer1.provider.getBalance(this.tokenVault.address)).to.equal(initialTokenVaultBalance.add(buyoutBidDeposit));
    expect(await this.tokenVault.buyoutEndTime()).to.equal(blockTime.add(BUYOUT_DURATION));
    expect(await this.tokenVault.lastBlockTimeStamp()).to.equal(blockTime);
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
    const _purchaseReturn = await mintTokens(this.testBancorBondingCurve, initialTokenSupply, primaryReserveBalance, primaryReserveRatio, _buyAmountWithFee);
    const _initialBalanceFactory = await this.admin.provider.getBalance(this.tokenVaultFactory.address);
    const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
    const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
    const _newSecondaryResRatio = _newSecondaryBalance.mul(SCALE).div(initialValuation);
    this.twav.addObservation(currentValuation, blockTime);
    await this.tokenVault.connect(this.buyer1).buy(_purchaseReturn, this.buyer1.address, { value: _buyAmount });
    currentValuation = (_newSecondaryBalance.mul(SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(fictitiousPrimaryReserveBalance)).mul(SCALE).div(primaryReserveRatio));
    expect(await this.tokenVault.balanceOf(this.buyer1.address)).to.equal(_purchaseReturn);
    // secondaryReserveBalance * SCALE /secondaryReserveRatio) + ((primaryReserveBalance - fictitiousPrimaryReserveBalance) * SCALE  /primaryReserveRatio
    expect(await this.tokenVault.secondaryReserveBalance()).to.equal(_newSecondaryBalance);
    expect(await this.tokenVault.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
    // const twavObs0 = await this.tokenVault.twavObservations(0)
    const twavObs1 = await this.tokenVault.twavObservations(1)
    
    expect(twavObs1.timestamp).to.equal(this.twav.twavObservations[1].timestamp);    
    expect(twavObs1.cumulativeValuation).to.equal(this.twav.twavObservations[1].cumulativeValuation);
    // expect(await this.tokenVault.getCurrentValuation()).to.equal(_newValuation);
    // expect((await this.admin.provider.getBalance(this.tokenVaultFactory.address)).sub(_initialBalanceFactory)).to.equal((_buyAmount.mul(FEE_ADMIN)).div(SCALE));        
    // expect(await this.tokenVault.secondaryReserveRatio()).to.equal(_newSecResRatio);        
    // expect(await this.tokenVault.feeAccruedCurator()).to.equal((_buyAmount.mul(FEE_CURATOR)).div(SCALE));        


    // ---------------------------Bought Tokens--------------------------------


  
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
