import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { BigNumber, Contract, Signer } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO, ZERO, latest, advanceTimeAndBlock, duration, ADDRESS_ZERO, E18 } from "./helper";
import * as constants from "./constants";
import { TWAV } from './helper/twav';


describe("Buyout", function () {
    let accounts: Signer[];
    let snapshotId: Number;
    let admin: Signer;
    let implementorRole: Signer;
    let pauserRole: Signer;
    let feeRole: Signer;
    let curator: Signer;
    let buyer1: Signer;
    let buyer2: Signer;
    

    let erc721: Contract;
    let vaultContract: Contract;
    let vaultImplementationContract: Contract;
    let vaultFactoryContract: Contract;
    let testBancorFormula: Contract;
    let twav: TWAV;

    let adminAddress: string;
    let implementorRoleAddress: string;
    let pauserRoleAddress: string;
    let feeRoleAddress: string;
    let curatorAddress: string;
    let buyer1Address: string;
    let buyer2Address: string;

    before(async function () {
        accounts = await ethers.getSigners();   
        admin = accounts[0];
        implementorRole = accounts[1];
        pauserRole = accounts[2];
        feeRole = accounts[3];
        curator = accounts[4];
        buyer1 = accounts[5];
        buyer2 = accounts[6];

        adminAddress = await admin.getAddress();
        implementorRoleAddress = await implementorRole.getAddress();
        pauserRoleAddress = await pauserRole.getAddress();
        feeRoleAddress = await feeRole.getAddress();
        curatorAddress = await curator.getAddress();
        buyer1Address = await buyer1.getAddress();
        buyer2Address = await buyer2.getAddress();


        const Erc721 = await ethers.getContractFactory("ERC721Token");
        erc721 = await Erc721.deploy();
        await erc721.deployed(); 

        await erc721.mint(await curator.getAddress(), 0);


        const TestBancorBondingCurve = await ethers.getContractFactory("TestBancorFormula");
        testBancorFormula = await TestBancorBondingCurve.deploy();
        await testBancorFormula.deployed();

        const NibblVault = await ethers.getContractFactory("NibblVault");
        vaultImplementationContract = await NibblVault.deploy();
        await vaultImplementationContract.deployed();

        const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");

        vaultFactoryContract = await NibblVaultFactory.connect(admin).deploy(vaultImplementationContract.address,
                                                                                    adminAddress,
                                                                                    adminAddress); 
        await vaultFactoryContract.deployed();
        await erc721.connect(curator).approve(vaultFactoryContract.address, 0);

        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.FEE_ROLE(), await feeRole.getAddress());
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.PAUSER_ROLE(), await pauserRole.getAddress());
        await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), await implementorRole.getAddress());
        
        await vaultFactoryContract.connect(curator).createVault(erc721.address,
                                            curatorAddress,
                                            constants.tokenName,
                                            constants.tokenSymbol,
                                            0,
                                            constants.initialTokenSupply,
                                            constants.initialTokenPrice,
                                            (await latest()).add(duration.days(1)),
                                            { value: constants.initialSecondaryReserveBalance });

      const proxyAddress = await vaultFactoryContract.getVaultAddress(curatorAddress, erc721.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);
      vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, curator);
        
    });
    
    beforeEach(async function () {
        twav = new TWAV();
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

  it("Should initiate buyout when bid == currentValuation", async function () {
        await advanceTimeAndBlock(duration.days(1));
        const currentValuation: BigNumber = constants.initialValuation;
        const buyoutRejectionValuation: BigNumber = currentValuation.mul((constants.SCALE).add(constants.rejectionPremium)).div(constants.SCALE);
        const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
        // totalSupply() < constants.initialTokenSupply ? (secondaryReserveBalance * SCALE /secondaryReserveRatio) : ((primaryReserveBalance) * SCALE  / primaryReserveRatio);
        await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
        const blockTime = await latest();
        twav.addObservation(currentValuation, blockTime);
        expect(await vaultContract.buyoutValuationDeposit()).to.equal(buyoutBidDeposit);
        expect(await vaultContract.bidder()).to.equal(buyer1Address);
        expect(await vaultContract.buyoutBid()).to.equal(currentValuation);
        expect(await vaultContract.buyoutEndTime()).to.equal(blockTime.add(constants.BUYOUT_DURATION));
        expect(await vaultContract.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);
        expect(await vaultContract.status()).to.equal(1);
        expect(await vaultContract.lastBlockTimeStamp()).to.equal(blockTime);
    });

    it("Should initiate buyout when bid >= currentValuation", async function () {
        await advanceTimeAndBlock(duration.days(1));
        const currentValuation: BigNumber = constants.initialValuation;
        const initialTokenVaultBalance: BigNumber = await buyer1.provider.getBalance(vaultContract.address);
        const buyoutRejectionValuation: BigNumber = currentValuation.mul(constants.SCALE.add(constants.rejectionPremium)).div(constants.SCALE);
        const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
        await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
        const blockTime = await latest();
        twav.addObservation(currentValuation, blockTime);
        expect(await vaultContract.buyoutValuationDeposit()).to.equal(buyoutBidDeposit);
        expect(await vaultContract.bidder()).to.equal(buyer1Address);
        expect(await vaultContract.buyoutBid()).to.equal(currentValuation);
        expect(await vaultContract.buyoutEndTime()).to.equal(blockTime.add(constants.BUYOUT_DURATION));
        expect(await vaultContract.buyoutRejectionValuation()).to.equal(buyoutRejectionValuation);
        expect(await vaultContract.status()).to.equal(1);
        expect(await vaultContract.lastBlockTimeStamp()).to.equal(blockTime);
        expect(await buyer1.provider.getBalance(vaultContract.address)).to.equal(initialTokenVaultBalance.add(buyoutBidDeposit));
        const twavObs = await vaultContract.twavObservations(0)
        expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
        expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);
    });


    it("Should not initiate buyout when bid < currentValuation", async function () {
      await advanceTimeAndBlock(duration.days(1));
      const currentValuation: BigNumber = constants.initialValuation;
      const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      await expect(vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.div(BigNumber.from(2)) })).to.be.revertedWith("NibblVault: Bid too low");

  });

  it("Should not initiate buyout if minBuyoutTime < now", async function () {
        const currentValuation: BigNumber = constants.initialValuation;
        const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
        await expect(vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit })).to.be.revertedWith("NibblVault: minBuyoutTime < now");
    });
  
  
  it("Should update twav on buy when in buyout", async function () {
        await advanceTimeAndBlock(duration.days(1));
        let currentValuation: BigNumber = constants.initialValuation;
        const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
        await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
        let blockTime = await latest();
        twav.addObservation(currentValuation, blockTime);
        const twavObs = await vaultContract.twavObservations(0);
        expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
        expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);
        // -------------------------Buyout Initiated--------------------------
        // ----------------------------1st Buy Operation Initiated-----------------------------------  
        await advanceTimeAndBlock(duration.minutes(3));
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
        const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
        const _newSecondaryResRatio = _newSecondaryBalance.mul(constants.SCALE).div(constants.initialValuation);
        await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
        blockTime = await latest();
        twav.addObservation(currentValuation, blockTime);
        const twavObs1 = await vaultContract.twavObservations(1)
        expect(twavObs1.timestamp).to.equal(twav.twavObservations[1].timestamp);
        expect(twavObs1.cumulativeValuation).to.equal(twav.twavObservations[1].cumulativeValuation);
        // ----------------------------1st Buy Operation-----------------------------------  
        // ----------------------------2nd Buy Operation Initiated-----------------------------------  

        await advanceTimeAndBlock(duration.minutes(3));
        currentValuation = (_newSecondaryBalance.mul(constants.SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(constants.fictitiousPrimaryReserveBalance)).mul(constants.SCALE).div(constants.primaryReserveRatio));
        await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
        blockTime = await latest();
        twav.addObservation(currentValuation, blockTime);
        const twavObs2 = await vaultContract.twavObservations(2)
        expect(twavObs2.timestamp).to.equal(twav.twavObservations[2].timestamp);
        expect(twavObs2.cumulativeValuation).to.equal(twav.twavObservations[2].cumulativeValuation);
        // ----------------------------2nd Buy Operation-----------------------------------  
    });

  it("Should update twav on sell when in buyout", async function () {
    await advanceTimeAndBlock(duration.days(1));
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    let blockTime = await latest();
    twav.addObservation(currentValuation, blockTime);
    const twavObs = await vaultContract.twavObservations(0);
    expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);
    // -------------------------Buyout Initiated--------------------------
    
    const _sellAmount = (constants.initialTokenSupply).div(5);
    let _balanceAddr1 = await buyer1.provider.getBalance(buyer1Address);
    const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
    await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, buyer1Address);
    expect(await vaultContract.balanceOf(curatorAddress)).to.equal(constants.initialTokenSupply.sub(_sellAmount));
    expect((await buyer1.provider.getBalance(buyer1Address)).sub(_balanceAddr1)).to.equal((_expectedSaleReturn));        
    expect(await vaultContract.secondaryReserveBalance()).to.equal(constants.initialSecondaryReserveBalance.sub(_expectedSaleReturn));
    expect(await vaultContract.totalSupply()).to.equal(constants.initialTokenSupply.sub(_sellAmount));
    blockTime = await latest();
    twav.addObservation(currentValuation, blockTime);
    const twavObs1 = await vaultContract.twavObservations(1)
    expect(twavObs1.timestamp).to.equal(twav.twavObservations[1].timestamp);
    expect(twavObs1.cumulativeValuation).to.equal(twav.twavObservations[1].cumulativeValuation);
    // ----------------------------1st Sell Operation-----------------------------------  
    // ----------------------------2nd Sell Operation Initiated-----------------------------------  

    const _newSecondaryBalance = constants.initialSecondaryReserveBalance.sub(_expectedSaleReturn);
    const _newSecondaryResRatio = constants.initialSecondaryReserveRatio;//SecResRatio doesn't change
    expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecondaryBalance);
    currentValuation = (_newSecondaryBalance.mul(constants.SCALE).div(_newSecondaryResRatio));
    await vaultContract.connect(curator).sell(_sellAmount, 0, buyer1Address);
    blockTime = await latest();
    twav.addObservation(currentValuation, blockTime);
    const twavObs2 = await vaultContract.twavObservations(2)
    expect(twavObs2.timestamp).to.equal(twav.twavObservations[2].timestamp);
    expect(twavObs2.cumulativeValuation).to.equal(twav.twavObservations[2].cumulativeValuation);
    // ----------------------------2nd Buy Operation-----------------------------------  
  });

  it("Should reject buyout", async function () {
    await advanceTimeAndBlock(duration.days(1));
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    const buyoutRejectionValuation: BigNumber = currentValuation.mul(constants.SCALE.add(constants.rejectionPremium)).div(constants.SCALE);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    let blockTime = await latest();
    twav.addObservation(currentValuation, blockTime);
    const twavObs = await vaultContract.twavObservations(0);
    expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);
    // -------------------------Buyout Initiated--------------------------

    for (let index = 0; true; index++) {
        const _buyAmount = ethers.utils.parseEther("10");      
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
        const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
        const _newSecondaryResRatio = _newSecondaryBalance.mul(constants.SCALE).div(constants.initialValuation);
        let twavObs = await vaultContract.twavObservations(index % 6)
        await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
        await advanceTimeAndBlock(duration.minutes(3));
        blockTime = await latest();
        twav.addObservation(currentValuation, blockTime);
        currentValuation = (_newSecondaryBalance.mul(constants.SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(constants.fictitiousPrimaryReserveBalance)).mul(constants.SCALE).div(constants.primaryReserveRatio));
        if (twav.getTwav() >= buyoutRejectionValuation) {
            await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
            break;
        }
    }
    expect(await vaultContract.buyoutRejectionValuation()).to.equal(ZERO);
    expect(await vaultContract.buyoutEndTime()).to.equal(ZERO);
    expect((await vaultContract.bidder())).to.equal(ADDRESS_ZERO);
    expect((await vaultContract.twavObservations(0))[0]).to.equal(ZERO);
    expect(await vaultContract.twavObservationsIndex()).to.equal(ZERO);
    expect(await vaultContract.totalUnsettledBids()).to.equal(buyoutBidDeposit);
    expect(await vaultContract.unsettledBids(buyer1Address)).to.equal(buyoutBidDeposit);
  });


  it("Shouldn't be able to buy after buyout has been completed.", async function () {
    await advanceTimeAndBlock(duration.days(1));
    await advanceTimeAndBlock(duration.minutes(3));
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await advanceTimeAndBlock(duration.days(3));
    const _buyAmount = ethers.utils.parseEther("2");      
    await expect(vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount })).to.be.revertedWith("NibblVault: Bought Out");
  });


  it("Shouldn't be able to sell after buyout has been completed.", async function () {
    await advanceTimeAndBlock(duration.days(1));
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await advanceTimeAndBlock(duration.days(3));

    const _sellAmount = constants.initialTokenSupply.div(5);
    await expect(vaultContract.connect(curator).sell(_sellAmount, 0, buyer1Address)).to.be.revertedWith("NibblVault: Bought Out");
  });

  it("Shouldn't be able to initiate buyout with buyout already going on", async function () {
    await advanceTimeAndBlock(duration.days(1));

    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await expect(vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit })).to.be.revertedWith("NibblVault: Status!=initialized");
  });


  it("Should be able to withdraw unsettled bids", async function () {
    await advanceTimeAndBlock(duration.days(1));

    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//

    for (let index = 0; true; index++) {
        
      const _buyAmount = ethers.utils.parseEther("10");      
      const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
      const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
      const buyoutRejectionValuation: BigNumber = currentValuation.mul(constants.SCALE.add(constants.rejectionPremium)).div(constants.SCALE);
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
      const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
      const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
      const _newSecondaryResRatio = _newSecondaryBalance.mul(constants.SCALE).div(constants.initialValuation);
      let blockTime = await latest();
      await advanceTimeAndBlock(duration.minutes(3));
      twav.addObservation(currentValuation, blockTime);
      await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
      currentValuation = (_newSecondaryBalance.mul(constants.SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(constants.fictitiousPrimaryReserveBalance)).mul(constants.SCALE).div(constants.primaryReserveRatio));
      if (twav.getTwav() >= buyoutRejectionValuation) {
        break;
      }
    }
    // --------------------- Buyout Rejected--------------------------//
    const initialBal = await buyer1.provider.getBalance(vaultContract.address)
    await vaultContract.connect(buyer1).withdrawUnsettledBids(buyer1Address);
    expect(await buyer1.provider.getBalance(vaultContract.address)).to.be.equal(initialBal.sub(buyoutBidDeposit));
  });


  it("User should be able to initiate buyout after rejection of a bid", async function () {
    await advanceTimeAndBlock(duration.days(1));
   
    let currentValuation: BigNumber = constants.initialValuation;
    let buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    let buyoutRejectionValuation: BigNumber = currentValuation.mul(constants.SCALE.add(constants.rejectionPremium)).div(constants.SCALE);
    let _newPrimaryBalance;
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    let blockTime = await latest();
    twav.addObservation(currentValuation, blockTime);
    const twavObs = await vaultContract.twavObservations(0);
    expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);
    
    // -------------------------Buyout Initiated-------------------------- //
    for (let index = 0; true; index++) {
        const _buyAmount = ethers.utils.parseEther("10");      
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
        const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
        const _newSecondaryResRatio = _newSecondaryBalance.mul(constants.SCALE).div(constants.initialValuation);
        let twavObs = await vaultContract.twavObservations(index % 6)
        await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
        await advanceTimeAndBlock(duration.minutes(3));
        blockTime = await latest();
        twav.addObservation(currentValuation, blockTime);
        currentValuation = (_newSecondaryBalance.mul(constants.SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(constants.fictitiousPrimaryReserveBalance)).mul(constants.SCALE).div(constants.primaryReserveRatio));
        if (twav.getTwav() >= buyoutRejectionValuation) {
            await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
            break;
        }
    }
    expect(await vaultContract.status()).to.equal(0);
    expect(await vaultContract.buyoutRejectionValuation()).to.equal(ZERO);
    expect(await vaultContract.buyoutEndTime()).to.equal(ZERO);
    expect((await vaultContract.bidder())).to.equal(ADDRESS_ZERO);
    expect((await vaultContract.twavObservations(0))[0]).to.equal(ZERO);
    expect(await vaultContract.twavObservationsIndex()).to.equal(ZERO);
    expect(await vaultContract.totalUnsettledBids()).to.equal(buyoutBidDeposit);
    expect(await vaultContract.unsettledBids(buyer1Address)).to.equal(buyoutBidDeposit);
   // ------------------------------Buyout Rejected ------------------------------------ //

    currentValuation = _newPrimaryBalance.mul(constants.SCALE).div(constants.primaryReserveRatio);
    buyoutRejectionValuation = currentValuation.mul((constants.SCALE).add(constants.rejectionPremium)).div(constants.SCALE);
    buyoutBidDeposit = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer2).initiateBuyout({ value: buyoutBidDeposit.mul(getBigNumber(2, 1)) });
    blockTime = await latest();
    twav.addObservation(currentValuation, blockTime);
    expect(await vaultContract.bidder()).to.equal(buyer2Address);
    expect(await vaultContract.buyoutEndTime()).to.equal(blockTime.add(constants.BUYOUT_DURATION));
    expect(await vaultContract.status()).to.equal(1);
    expect(await vaultContract.lastBlockTimeStamp()).to.equal(blockTime);
   
 });
  
  
  it("Users should be able redeem funds after buyout", async function () {
    await advanceTimeAndBlock(duration.days(1));

    let balanceContract = constants.initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;

    let _buyAmount = ethers.utils.parseEther("20");      
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
    await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount }); 

    const _buyoutDeposit = getBigNumber("200");                                           
    await vaultContract.connect(buyer1).initiateBuyout({ value: _buyoutDeposit });
    // ---------------------Buyout Initiated--------------------------//
    
    balanceContract = await admin.provider.getBalance(vaultContract.address);
    await advanceTimeAndBlock(duration.hours(36));
    const balanceBuyer = await vaultContract.balanceOf(buyer1Address);
    const totalSupply = await vaultContract.totalSupply();
    const returnAmt: BigNumber = ((balanceContract.sub(curatorFeeAccrued)).mul(balanceBuyer)).div(totalSupply);    
    const initialBalBuyer: BigNumber = await admin.provider.getBalance(buyer2Address);
    await vaultContract.connect(buyer1).redeem(buyer2Address); 
    expect(await admin.provider.getBalance(buyer2Address)).to.be.equal(initialBalBuyer.add(returnAmt));
    expect(await vaultContract.balanceOf(buyer1Address)).to.be.equal(ethers.constants.Zero);
  });

  it("Users should not be able redeem funds before buyout", async function () {
    await advanceTimeAndBlock(duration.days(1));

    let balanceContract = constants.initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;

    let _buyAmount = ethers.utils.parseEther("20");      
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
    await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount }); 
// ---------------------Buyout Initiated--------------------------//
    
    await expect(vaultContract.connect(buyer1).redeem(buyer2Address)).to.be.revertedWith("NibblVault: status != buyout"); 
  });

  it("Users should not be able redeem funds before buyout", async function () {
    await advanceTimeAndBlock(duration.days(1));

    let balanceContract = constants.initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;

    let _buyAmount = ethers.utils.parseEther("20");      
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
    await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount }); 

    const _buyoutDeposit = getBigNumber("200");                                           
    await vaultContract.connect(buyer1).initiateBuyout({ value: _buyoutDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await expect(vaultContract.connect(buyer1).redeem(buyer2Address)).to.be.revertedWith("NibblVault: buyoutEndTime <= now"); 

  });

  
  it("Winner should be able to withdraw the locked NFT", async function () {
    await advanceTimeAndBlock(duration.days(1));
    
    const FEE_TOTAL = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//
    //withdrawNFT(address _assetAddress, address _to, uint256 _assetID)

    await vaultContract.connect(buyer1).withdrawERC721(await vaultContract.assetAddress(), await vaultContract.assetID(), buyer1Address);
    expect(await erc721.ownerOf(0)).to.be.equal(buyer1Address);
  });

  it("Only winner should be able to withdraw the locked NFT", async function () {
    await advanceTimeAndBlock(duration.days(1));
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//
    //withdrawNFT(address _assetAddress, address _to, uint256 _assetID)

    await expect(vaultContract.connect(buyer2).withdrawERC721(await vaultContract.assetAddress(), await vaultContract.assetID(), buyer1Address)).to.be.revertedWith("NibblVault: Only winner");
  });

  it("Winner should be able to withdraw multiple the locked NFT", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await erc721.mint(vaultContract.address, 1);
    await erc721.mint(vaultContract.address, 2);
    await advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [], _assetIDs = [];
    for (let i = 0; i < 3; i++) {
      _assetAddresses.push(erc721.address);
      _assetIDs.push(i);
    }
    await vaultContract.connect(buyer1).withdrawMultipleERC721(_assetAddresses, _assetIDs, buyer1Address);
    expect(await erc721.ownerOf(0)).to.be.equal(buyer1Address);
    expect(await erc721.ownerOf(1)).to.be.equal(buyer1Address);
    expect(await erc721.ownerOf(2)).to.be.equal(buyer1Address);
  });

  it("Only Winner should be able to withdraw multiple the locked NFT", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await erc721.mint(vaultContract.address, 1);
    await erc721.mint(vaultContract.address, 2);
    await advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [], _assetIDs = [];
    for (let i = 0; i < 3; i++) {
      _assetAddresses.push(erc721.address);
      _assetIDs.push(i);
    }
    await expect(vaultContract.connect(buyer2).withdrawMultipleERC721(_assetAddresses, _assetIDs, buyer1Address)).to.be.revertedWith("NibblVault: Only winner");
  });

  it("Winner should be able to withdraw locked ERC20", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC20Token = await ethers.getContractFactory("ERC20Token");
    const erc20 = await ERC20Token.deploy();
    await erc20.deployed();
    await erc20.mint(vaultContract.address, amount);

    await advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//

    await vaultContract.connect(buyer1).withdrawERC20(erc20.address, buyer1Address);
    expect(await erc20.balanceOf(buyer1Address)).to.be.equal(amount);
   });

  it("Only Winner should be able to withdraw locked ERC20", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC20Token = await ethers.getContractFactory("ERC20Token");
    const erc20 = await ERC20Token.deploy();
    await erc20.deployed();
    await erc20.mint(vaultContract.address, amount);

    await advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//

    await expect(vaultContract.connect(buyer2).withdrawERC20(erc20.address, buyer1Address)).to.be.revertedWith("NibblVault: Only winner");

  });
  
  
  it("Winner should be able to withdraw locked ERC20s", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    
    const ERC20Token = await ethers.getContractFactory("ERC20Token");
    const erc20a = await ERC20Token.deploy();
    await erc20a.deployed();
    await erc20a.mint(vaultContract.address, amount);
    const erc20b = await ERC20Token.deploy();
    await erc20b.deployed();
    await erc20b.mint(vaultContract.address, amount);

    advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [];
    _assetAddresses.push(erc20a.address, erc20b.address);

    await vaultContract.connect(buyer1).withdrawMultipleERC20(_assetAddresses, buyer1Address);
    expect(await erc20a.balanceOf(buyer1Address)).to.be.equal(amount);
    expect(await erc20b.balanceOf(buyer1Address)).to.be.equal(amount);
  });

  it("Only Winner should be able to withdraw locked ERC20s", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    
    const ERC20Token = await ethers.getContractFactory("ERC20Token");
    const erc20a = await ERC20Token.deploy();
    await erc20a.deployed();
    await erc20a.mint(vaultContract.address, amount);
    const erc20b = await ERC20Token.deploy();
    await erc20b.deployed();
    await erc20b.mint(vaultContract.address, amount);

    advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [];
    _assetAddresses.push(erc20a.address, erc20b.address);

    await expect(vaultContract.connect(buyer2).withdrawMultipleERC20(_assetAddresses, buyer1Address)).to.be.revertedWith("NibblVault: Only winner");
  });


  it("Winner should be able to withdraw locked ERC1155s", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC1155Token = await ethers.getContractFactory("ERC1155Token");
    const erc1155 = await ERC1155Token.deploy();
    await erc1155.deployed();
    await erc1155.mint(vaultContract.address, 0, amount);
    
    advanceTimeAndBlock(duration.hours(36));
    await vaultContract.connect(buyer1).withdrawERC1155(erc1155.address, 0, buyer1Address);
    expect(await erc1155.balanceOf(buyer1Address, 0)).to.be.equal(amount);
  });

  it("Only Winner should be able to withdraw locked ERC1155s", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC1155Token = await ethers.getContractFactory("ERC1155Token");
    const erc1155 = await ERC1155Token.deploy();
    await erc1155.deployed();
    await erc1155.mint(vaultContract.address, 0, amount);
    
    advanceTimeAndBlock(duration.hours(36));
    await expect(vaultContract.connect(buyer2).withdrawERC1155(erc1155.address, 0, buyer1Address)).to.be.revertedWith("NibblVault: Only winner");
  });


  it("Winner should be able to withdraw multiple locked ERC1155s", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC1155Token = await ethers.getContractFactory("ERC1155Token");
    const erc1155 = await ERC1155Token.deploy();
    await erc1155.deployed();
    await erc1155.mint(vaultContract.address, 0, amount);
    await erc1155.mint(vaultContract.address, 1, amount);
    
    advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [], _assetIDs = [0, 1];
    _assetAddresses.push(erc1155.address, erc1155.address);
    
    await vaultContract.connect(buyer1).withdrawMultipleERC1155(_assetAddresses, _assetIDs, buyer1Address);
    expect(await erc1155.balanceOf(buyer1Address, 0)).to.be.equal(amount);
    expect(await erc1155.balanceOf(buyer1Address, 1)).to.be.equal(amount);
  });
  
  it("Only Winner should be able to withdraw multiple locked ERC1155s", async function () {
    await advanceTimeAndBlock(duration.days(1));

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC1155Token = await ethers.getContractFactory("ERC1155Token");
    const erc1155 = await ERC1155Token.deploy();
    await erc1155.deployed();
    await erc1155.mint(vaultContract.address, 0, amount);
    await erc1155.mint(vaultContract.address, 1, amount);
    
    advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//
    let _assetAddresses = [], _assetIDs = [0, 1];
    _assetAddresses.push(erc1155.address, erc1155.address);
    
    await expect(vaultContract.connect(buyer2).withdrawMultipleERC1155(_assetAddresses, _assetIDs, buyer1Address)).to.be.revertedWith("NibblVault: Only winner");
  });

  it("Should update twav only once on buy in a block when in buyout", async function () {
        await network.provider.send("evm_setAutomine", [false]);
        await advanceTimeAndBlock(duration.days(1));
        let currentValuation: BigNumber = constants.initialValuation;
        const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
        await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
        await network.provider.send("evm_mine");
        let blockTime = await latest();
        twav.addObservation(currentValuation, blockTime);
        const twavObs = await vaultContract.twavObservations(0);
        expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
        expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);

        // -------------------------Buyout Initiated--------------------------
        // ----------------------------1st Buy Operation Initiated-----------------------------------  
        await advanceTimeAndBlock(duration.minutes(3));
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
        const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
        const _newSecondaryResRatio = _newSecondaryBalance.mul(constants.SCALE).div(constants.initialValuation);
        await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
        twav.addObservation(currentValuation, blockTime);
        // ----------------------------1st Buy Operation-----------------------------------  
        // ----------------------------2nd Buy Operation Initiated-----------------------------------  
        currentValuation = (_newSecondaryBalance.mul(constants.SCALE).div(_newSecondaryResRatio)).add((_newPrimaryBalance.sub(constants.fictitiousPrimaryReserveBalance)).mul(constants.SCALE).div(constants.primaryReserveRatio));
        await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
        await network.provider.send("evm_mine");
        const twavObservations = await vaultContract.getTwavObservations()
        expect(twavObservations[3][0]).to.equal(0);
        expect(twavObservations[3][1]).to.equal(0);     
        await network.provider.send("evm_setAutomine", [true]);
  });
  
   it("Should update twav only once on sell in a block when in buyout", async function () {
    await network.provider.send("evm_setAutomine", [false]);
    await advanceTimeAndBlock(duration.days(1));
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
    await network.provider.send("evm_mine");
    let blockTime = await latest();
    twav.addObservation(currentValuation, blockTime);
    const twavObs = await vaultContract.twavObservations(0);
    expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
    expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);

    // -------------------------Buyout Initiated--------------------------
    
    const _sellAmount = (constants.initialTokenSupply).div(5);
    let _balanceAddr1 = await buyer1.provider.getBalance(buyer1Address);
    const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
    await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, buyer1Address);
    blockTime = await latest();
    twav.addObservation(currentValuation, blockTime);
    const twavObs1 = await vaultContract.twavObservations(1)
    // ----------------------------1st Sell Operation-----------------------------------  
    // ----------------------------2nd Sell Operation Initiated-----------------------------------  

    const _newSecondaryBalance = constants.initialSecondaryReserveBalance.sub(_expectedSaleReturn);
    const _newSecondaryResRatio = constants.initialSecondaryReserveRatio;//SecResRatio doesn't change
    // expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecondaryBalance);
    currentValuation = (_newSecondaryBalance.mul(constants.SCALE).div(_newSecondaryResRatio));
    await vaultContract.connect(curator).sell(_sellAmount, 0, buyer1Address);
    await network.provider.send("evm_mine");
    // ----------------------------2nd Buy Operation-----------------------------------  
    await network.provider.send("evm_setAutomine", [true]);

  });



    it("Should update twav externally without a trade", async function () {
      await advanceTimeAndBlock(duration.days(1));
      let currentValuation: BigNumber = constants.initialValuation;
      const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
      let blockTime = await latest();
      twav.addObservation(currentValuation, blockTime);
      const twavObs = await vaultContract.twavObservations(0);
      expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
      expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);

      // -------------------------Buyout Initiated--------------------------
      // ----------------------------1st Buy Operation Initiated-----------------------------------  
      await advanceTimeAndBlock(duration.minutes(3));
      const _buyAmount = ethers.utils.parseEther("1");
      const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
      const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
      const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
      const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
      const _newSecondaryResRatio = _newSecondaryBalance.mul(constants.SCALE).div(constants.initialValuation);
      await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
      twav.addObservation(currentValuation, blockTime);
      // ----------------------------1st Buy Operation-----------------------------------  
      await advanceTimeAndBlock(duration.minutes(3));
      await vaultContract.connect(buyer1).updateTWAV();
      const twavObservations = await vaultContract.getTwavObservations()      
      expect(twavObservations[2][0]).to.not.equal(0);
      expect(twavObservations[2][1]).to.not.equal(0);     
    });


  it("Should update twav only once externally without a trade in a block", async function () {
      await network.provider.send("evm_setAutomine", [false]);
      await advanceTimeAndBlock(duration.days(1));
      let currentValuation: BigNumber = constants.initialValuation;
      const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit.mul(BigNumber.from(2)) });
      await network.provider.send("evm_mine");

      let blockTime = await latest();
      twav.addObservation(currentValuation, blockTime);
      const twavObs = await vaultContract.twavObservations(0);
      expect(twavObs.timestamp).to.equal(twav.twavObservations[0].timestamp);
      expect(twavObs.cumulativeValuation).to.equal(twav.twavObservations[0].cumulativeValuation);

      // -------------------------Buyout Initiated--------------------------
      // ----------------------------1st Buy Operation Initiated-----------------------------------  
      await advanceTimeAndBlock(duration.minutes(3));
      const _buyAmount = ethers.utils.parseEther("1");
      const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
      const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
      const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
      const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
      const _newPrimaryBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
      const _newSecondaryBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
      const _newSecondaryResRatio = _newSecondaryBalance.mul(constants.SCALE).div(constants.initialValuation);
      await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount });
      // ----------------------------1st Buy Operation-----------------------------------  
      await vaultContract.connect(buyer1).updateTWAV();
      await network.provider.send("evm_mine");
      const twavObservations = await vaultContract.getTwavObservations()      
      expect(twavObservations[2][0]).to.equal(0);
      expect(twavObservations[2][1]).to.equal(0);     
      await network.provider.send("evm_setAutomine", [true]);

    });


    it("Should not update twav externally without buyout", async function () {
      await expect(vaultContract.connect(buyer1).updateTWAV()).to.be.revertedWith("NibblVault: Status!=Buyout");
    });

    it("Only winner should be able to withdraw the locked NFT", async function () {
      await advanceTimeAndBlock(duration.days(1));
      

      const buyoutBidDeposit = ethers.utils.parseEther("1000");
      await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
      // ---------------------Buyout Initiated--------------------------//
      await advanceTimeAndBlock(duration.hours(36));
      // ---------------------Buyout Finished--------------------------//
      //withdrawNFT(address _assetAddress, address _to, uint256 _assetID)
      await expect(vaultContract.connect(buyer2).withdrawERC721(await vaultContract.assetAddress(), await vaultContract.assetID(), buyer1Address)).to.be.revertedWith("NibblVault: Only winner");
    });
  
    it("should transfer ERC1155", async function () {

      const amount = 1000000;    

      const ERC1155Token = await ethers.getContractFactory("ERC1155Token");
      const erc1155 = await ERC1155Token.deploy();
      await erc1155.deployed();
    //       function _mintBatch(
    //     address to,
    //     uint256[] memory ids,
    //     uint256[] memory amounts,
    // ) 
      const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const amounts = [amount, amount, amount, amount, amount, amount, amount, amount, amount, amount];
      await erc1155.mintBatch(curatorAddress, ids, amounts);
      await erc1155.connect(curator).safeBatchTransferFrom(curatorAddress, vaultContract.address, ids, amounts, "0x00");
    });
  
});