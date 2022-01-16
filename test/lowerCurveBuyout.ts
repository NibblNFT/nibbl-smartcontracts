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
//   it("Buyout succeeds when time passes and twav<buyoutrejectionvaluation throughout the 3 days", async function () {
//     const buyoutBid = ethers.utils.parseEther("200");
//     await this.tokenVault
//       .connect(this.buyer1)
//       .initiateBuyout({ value: buyoutBid });
//     await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
//     await this.tokenVault.connect(this.buyer1).unlockNFT(this.buyer1.address);
//     const owner = await this.nft.ownerOf(0);
//     expect(owner).to.be.equal(this.buyer1.address);
//   });

//   it("When after buyout in surplus condition Token holder is able to redeem tokens for ETH in proportion to the supply they own", async function () {
//     const _buyAmount = ethers.utils.parseEther("1");
//     await this.tokenVault
//       .connect(this.buyer1)
//       .buy(0, this.buyer1.address, { value: _buyAmount });
//     const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
//       this.buyer1.address
//     );
//     const buyoutBidAmount = ethers.utils.parseEther("200");
//     await this.tokenVault
//       .connect(this.addr1)
//       .initiateBuyout({ value: buyoutBidAmount });
//     const buyoutBid = await this.tokenVault.buyoutBid();
//     //more buying to increase vault balance
//     await this.tokenVault
//       .connect(this.addr1)
//       .buy(0, this.addr1.address, { value: _buyAmount.mul(5) }); //5 ETH buy
//     await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);

//     const contractBalBeforeUnlock = await this.admin.provider.getBalance(
//       this.tokenVault.address
//     );
//     await this.tokenVault.connect(this.addr1).unlockNFT(this.addr1.address);

//     const curatorFee = await this.tokenVault.feeAccruedCurator();
//     const contractBalBeforeRedeem = await this.admin.provider.getBalance(
//       this.tokenVault.address
//     );
//     const expectedRefund = contractBalBeforeUnlock.sub(
//       buyoutBid.add(curatorFee)
//     );
//     const refundIssued = contractBalBeforeUnlock.sub(contractBalBeforeRedeem);
//     expect(expectedRefund).to.be.equal(refundIssued);

//     const totalSupply = await this.tokenVault.totalSupply();
//     const expectedETH = tokenBalBeforeRedeem.mul(buyoutBid).div(totalSupply);
//     await this.tokenVault.connect(this.buyer1).redeem();
//     const contractBalAfterRedeem = await this.admin.provider.getBalance(
//       this.tokenVault.address
//     );
//     const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
//       this.buyer1.address
//     );
//     const redeemedAmount = contractBalBeforeRedeem.sub(contractBalAfterRedeem);
//     expect(tokenBalAfterRedeem).to.be.equal(0);
//     expect(redeemedAmount).to.be.equal(expectedETH);
//   });

//   it("Redeeming before unlocking", async function () {
//     const _buyAmount = ethers.utils.parseEther("1");
//     await this.tokenVault
//       .connect(this.buyer1)
//       .buy(0, this.buyer1.address, { value: _buyAmount });
//     const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
//       this.buyer1.address
//     );
//     const buyoutBidAmount = ethers.utils.parseEther("200");
//     await this.tokenVault
//       .connect(this.addr1)
//       .initiateBuyout({ value: buyoutBidAmount });
//     const buyoutBid = await this.tokenVault.buyoutBid();
//     //more buying to increase vault balance
//     await this.tokenVault
//       .connect(this.addr1)
//       .buy(0, this.addr1.address, { value: _buyAmount.mul(5) }); //5 ETH buy
//     await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
//     const contractBalBeforeRedeem = await this.admin.provider.getBalance(
//       this.tokenVault.address
//     );

//     const totalSupply = await this.tokenVault.totalSupply();
//     const expectedETH = tokenBalBeforeRedeem.mul(buyoutBid).div(totalSupply);
//     await this.tokenVault.connect(this.buyer1).redeem();
//     const contractBalAfterRedeem = await this.admin.provider.getBalance(
//       this.tokenVault.address
//     );
//     const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
//       this.buyer1.address
//     );
//     const redeemedAmount = contractBalBeforeRedeem.sub(contractBalAfterRedeem);
//     expect(tokenBalAfterRedeem).to.be.equal(0);
//     expect(redeemedAmount).to.be.equal(expectedETH);
//   });

//   it("When after buyout in deficit condition Token holder is able to redeem tokens for ETH in proportion to the supply they own", async function () {
//     //Buying some tokens to sell later
//     const _buyAmount = ethers.utils.parseEther("1");
//     await this.tokenVault
//       .connect(this.buyer1)
//       .buy(0, this.buyer1.address, { value: _buyAmount });
//     const tokenBalBeforeRedeem = await this.tokenVault.balanceOf(
//       this.buyer1.address
//     );
//     const buyoutBidAmount = ethers.utils.parseEther("100");
//     await this.tokenVault
//       .connect(this.addr1)
//       .initiateBuyout({ value: buyoutBidAmount });
//     const buyoutBid = await this.tokenVault.buyoutBid();
//     //selling tokens to decrease the contract balance
//     await this.tokenVault
//       .connect(this.curator)
//       .sell(tokenBalBeforeRedeem, 0, this.curator.address);
//     await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60 + 1]);
//     const totalSupply = await this.tokenVault.totalSupply();
//     const contractBalBeforeUnlock = await this.admin.provider.getBalance(
//       this.tokenVault.address
//     );

//     await this.tokenVault.connect(this.addr1).unlockNFT(this.addr1.address);
//     const contractBalBeforeRedeem = await this.admin.provider.getBalance(
//       this.tokenVault.address
//     );
//     const refundIssued = contractBalBeforeUnlock.sub(contractBalBeforeRedeem);
//     expect(refundIssued).to.be.equal(0);

//     await this.tokenVault.connect(this.buyer1).redeem();
//     const tokenBalAfterRedeem = await this.tokenVault.balanceOf(
//       this.buyer1.address
//     );
//     expect(tokenBalAfterRedeem).to.be.equal(0);
//     const curatorFee = await this.tokenVault.feeAccruedCurator();
//     const contractBalAfterRedeem = await this.admin.provider.getBalance(
//       this.tokenVault.address
//     );
//     const redeemedAmount = contractBalBeforeRedeem.sub(contractBalAfterRedeem);
//     const expectedETH = tokenBalBeforeRedeem
//       .mul(contractBalBeforeRedeem.sub(curatorFee))
//       .div(totalSupply);
//     expect(redeemedAmount).to.be.equal(expectedETH);
//   });

//   it(" Mint/Burn stops after success", async function () {
//     const _buyAmount = ethers.utils.parseEther("1");
//     const buyoutBid = ethers.utils.parseEther("200");
//     this.tokenVault
//       .connect(this.buyer1)
//       .buy(0, this.buyer1.address, { value: _buyAmount });
//     await this.tokenVault
//       .connect(this.buyer1)
//       .initiateBuyout({ value: buyoutBid });
//     await network.provider.send("evm_increaseTime", [3 * 24 * 60 * 60]);
//     await expect(
//       this.tokenVault
//         .connect(this.buyer1)
//         .buy(0, this.buyer1.address, { value: _buyAmount })
//     ).to.revertedWith("NFT has been bought");
//     await expect(
//       this.tokenVault
//         .connect(this.buyer1)
//         .sell(_buyAmount, 0, this.buyer1.address)
//     ).to.revertedWith("NFT has been bought");
//   });
//   it("No more buyout bids possible", async function () {
//     const buyoutBid = ethers.utils.parseEther("200");
//     await this.tokenVault
//       .connect(this.buyer1)
//       .initiateBuyout({ value: buyoutBid });
//     await expect(
//       this.tokenVault.connect(this.addr1).initiateBuyout({ value: buyoutBid })
//     ).to.revertedWith("NibblVault: Only when initialised");
//   });
//   it("Buyout rejects automatically when twav>=buyoutrejectionvaluation within 3 days", async function () {
//     const _buyAmount = ethers.utils.parseEther("1");
//     //Filling the TWAV array
//     for (let i = 0; i < 12; i++) {
//       this.tokenVault
//         .connect(this.addr1)
//         .buy(0, this.buyer1.address, { value: _buyAmount });
//     }
//     const weightedValuation = await this.tokenVault._getTwav();
//     const bidAmount = weightedValuation.mul(3);
//     await this.tokenVault
//       .connect(this.buyer1)
//       .initiateBuyout({ value: bidAmount });
//     let buyoutRejectionValuation =
//       await this.tokenVault.buyoutRejectionValuation();
//     const buyAmountToReject = buyoutRejectionValuation.sub(weightedValuation);
//     const balanceBeforeRejection = await this.admin.provider.getBalance(
//       this.buyer1.address
//     );
//     this.tokenVault
//       .connect(this.addr1)
//       .buy(0, this.addr1.address, { value: buyAmountToReject });
//     for (let i = 0; i < 12; i++) {
//       this.tokenVault
//         .connect(this.addr1)
//         .buy(0, this.addr1.address, { value: _buyAmount });
//       let valuationAfterOrder = await this.tokenVault._getTwav();
//       const status = await this.tokenVault.status();
//       if (valuationAfterOrder > buyoutRejectionValuation) {
//         expect(status).to.be.equal(0);
//       } else {
//         expect(status).to.be.equal(1);
//       }
//     }
//     const balanceAfterRejection = await this.admin.provider.getBalance(
//       this.buyer1.address
//     );
//     expect(balanceAfterRejection).to.be.equal(
//       balanceBeforeRejection.add(bidAmount)
//     );
//     //Mint Works after rejection
//     await this.tokenVault
//       .connect(this.buyer1)
//       .buy(0, this.buyer1.address, { value: _buyAmount });
//     await this.tokenVault
//       .connect(this.buyer1)
//       .sell(_buyAmount, 0, this.buyer1.address);
//   });
//   it("Buyout bid is rejected if the valuation is low", async function () {
//     //TODO compute valutation and place bid acordingly
//     const buyoutBid = ethers.utils.parseEther("0.01");
//     await expect(
//       this.tokenVault.connect(this.buyer1).initiateBuyout({ value: buyoutBid })
//     ).to.revertedWith("NibblVault: Bid too low");
//   });
});
