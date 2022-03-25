import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, Signer } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO, ZERO, latest, advanceTimeAndBlock, duration, ADDRESS_ZERO, E18 } from "./helper";
import * as constants from "./constants";
import { TWAV } from './helper/twav';


describe("Upgradablity", function () {
    let accounts: Signer[];
    let snapshotId: Number;
    let admin: Signer;
    let implementorRole: Signer;
    let pauserRole: Signer;
    let feeRole: Signer;
    let curator: Signer;
    let buyer1: Signer;
    let buyer2: Signer;
    let addr1: Signer;
    

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
        addr1 = accounts[7];
        
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
                                            0,
                                            constants.tokenName,
                                            constants.tokenSymbol,
                                            constants.initialTokenSupply,
                                            constants.initialTokenPrice,
                                            await latest(),
                                            { value: constants.initialSecondaryReserveBalance });

        const proxyAddress = await vaultFactoryContract.getVaultAddress(curatorAddress, erc721.address, 0, constants.tokenName, constants.tokenSymbol, constants.initialTokenSupply);
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, curator);

        const UpgradedNibblVault = await ethers.getContractFactory("UpgradedNibblVault");
        vaultImplementationContract = await UpgradedNibblVault.deploy();
        await vaultImplementationContract.deployed();

        await vaultFactoryContract.connect(implementorRole).proposeNewVaultImplementation(vaultImplementationContract.address);

        await advanceTimeAndBlock(constants.UPDATE_TIME_FACTORY);
        await vaultFactoryContract.updateVaultImplementation();
    });
    
    beforeEach(async function () {
        twav = new TWAV();
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("Should initiate buyout when bid == currentValuation", async function () {
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


    it("Should update twav on buy when in buyout", async function () {
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
    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub((constants.initialPrimaryReserveBalance).sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await advanceTimeAndBlock(duration.days(3));

    const _sellAmount = constants.initialTokenSupply.div(5);
    await expect(vaultContract.connect(curator).sell(_sellAmount, 0, buyer1Address)).to.be.revertedWith("NibblVault: Bought Out");
  });

  it("Shouldn't be able to initiate buyout with buyout already going on", async function () {

    let currentValuation: BigNumber = constants.initialValuation;
    const buyoutBidDeposit: BigNumber = currentValuation.sub(constants.initialPrimaryReserveBalance.sub(constants.fictitiousPrimaryReserveBalance)).sub(constants.initialSecondaryReserveBalance);
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    await expect(vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit })).to.be.revertedWith("NibblVault: Status!=Initialised");
  });


  it("Should be able to withdraw unsettled bids", async function () {
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
    await vaultContract.connect(buyer2).initiateBuyout({ value: buyoutBidDeposit });
    blockTime = await latest();
    twav.addObservation(currentValuation, blockTime);
    expect(await vaultContract.bidder()).to.equal(buyer2Address);
    expect(await vaultContract.buyoutEndTime()).to.equal(blockTime.add(constants.BUYOUT_DURATION));
    expect(await vaultContract.status()).to.equal(1);
    expect(await vaultContract.lastBlockTimeStamp()).to.equal(blockTime);
   
 });
  
  
  it("Users should be able redeem funds after buyout", async function () {
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
    let balanceContract = constants.initialSecondaryReserveBalance, curatorFeeAccrued = ethers.constants.Zero;

    let _buyAmount = ethers.utils.parseEther("20");      
    curatorFeeAccrued = curatorFeeAccrued.add((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));
    await vaultContract.connect(buyer1).buy(0, buyer1Address, { value: _buyAmount }); 
// ---------------------Buyout Initiated--------------------------//
    
    await expect(vaultContract.connect(buyer1).redeem(buyer2Address)).to.be.revertedWith("NibblVault: status != buyout"); 
  });

  it("Users should not be able redeem funds before buyout", async function () {
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
    
    const FEE_TOTAL = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);

    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//
    //withdrawNFT(address _assetAddress, address _to, uint256 _assetID)

    await vaultContract.connect(buyer1).withdrawERC721(await vaultContract.assetAddress(), await vaultContract.assetID(), buyer1Address);
    expect(await erc721.ownerOf(0)).to.be.equal(buyer1Address);
  });

  it("Winner should be able to withdraw multiple the locked NFT", async function () {
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    erc721.mint(vaultContract.address, 1);
    erc721.mint(vaultContract.address, 2);
    advanceTimeAndBlock(duration.hours(36));
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

  it("Winner should be able to withdraw locked ERC20s", async function () {
    const buyoutBidDeposit = ethers.utils.parseEther("1000");
    await vaultContract.connect(buyer1).initiateBuyout({ value: buyoutBidDeposit });
    // ---------------------Buyout Initiated--------------------------//
    const amount = 1000000;    

    const ERC20Token = await ethers.getContractFactory("ERC20Token");
    const erc20 = await ERC20Token.deploy();
    await erc20.deployed();
    await erc20.mint(vaultContract.address, amount);

    advanceTimeAndBlock(duration.hours(36));
    // ---------------------Buyout Finished--------------------------//

    await vaultContract.connect(buyer1).withdrawERC20(erc20.address, buyer1Address);
    expect(await erc20.balanceOf(buyer1Address)).to.be.equal(amount);
   });

  
  it("Winner should be able to withdraw locked ERC20s", async function () {
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


  it("Winner should be able to withdraw locked ERC1155s", async function () {
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

  it("Winner should be able to withdraw multiple locked ERC1155s", async function () {
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
        it("should buy tokens successfully from primary curve", async function () {
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula,
                                                constants.initialTokenSupply,
                                                constants.fictitiousPrimaryReserveBalance,
                                                constants.primaryReserveRatio,
                                                _buyAmountWithFee);
        const _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        const _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURVE)).div(constants.SCALE));
        await vaultContract.connect(buyer1).buy(_purchaseReturn,await buyer1.getAddress(), { value: _buyAmount });
        
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecBalance);
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
        expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_buyAmount.mul(constants.FEE_ADMIN)).div(constants.SCALE));        
        expect(await vaultContract.secondaryReserveRatio()).to.equal((_newSecBalance.mul(constants.SCALE)).div(constants.initialValuation));        
        expect(await vaultContract.feeAccruedCurator()).to.equal((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));        
    })

    it("should buy tokens successfully on multi curve", async function () {
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);

        //Selling Tokens
        const _sellAmount = (constants.initialTokenSupply).div(5); //Selling 1/5th the amount i.e 200k here
        const _expectedSaleReturn = await burnTokens(
                                                    testBancorFormula,
                                                    constants.initialTokenSupply,
                                                    constants.initialSecondaryReserveBalance,
                                                    constants.initialSecondaryReserveRatio,
                                                    _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await curator.getAddress());
        //---------------- 1/5th Tokens Sold ----------------        
        //Buy Tokens
        const _buyAmtTotal = ethers.utils.parseEther("20");
        const _buyAmtSecCurve = _expectedSaleReturn; //secondaryCurve doesn't have any fee so exact amount
        const _purchaseReturnSecCurve = _sellAmount;
        
        const _buyAmtPrimaryCurve = _buyAmtTotal.sub(_buyAmtSecCurve);
        const _buyAmtPrimaryWithFee = _buyAmtPrimaryCurve.sub(_buyAmtPrimaryCurve.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturnPrimaryCurve = await mintTokens(testBancorFormula, constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmtPrimaryWithFee);        
        // Primary curve goes up from initialSupply. Therefore, constant.initialTokenSupply is used as continuousTokenSupply.
        const _initialBalanceBuyer = await vaultContract.balanceOf(await buyer1.getAddress());
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        
        await vaultContract.connect(buyer1).buy(_purchaseReturnPrimaryCurve.add(_purchaseReturnSecCurve), await buyer1.getAddress(), { value: _buyAmtTotal });
        expect((await vaultContract.balanceOf(await buyer1.getAddress())).sub(_initialBalanceBuyer)).to.equal(_purchaseReturnPrimaryCurve.add(_purchaseReturnSecCurve));
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_initialSecondaryBalance.add(_buyAmtSecCurve).add(_buyAmtPrimaryCurve.mul(constants.FEE_CURVE).div(constants.SCALE)));
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmtPrimaryWithFee));
    })

    it("should buy tokens successfully on secondary curve", async function () {
        //Selling Tokens
        const _sellAmount = constants.initialTokenSupply.sub(constants.initialTokenSupply.div(4)); //Selling 1/5th the amount i.e 200k here
        const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await curator.getAddress());
        //---------------- 3/4th Tokens Sold ----------------        
        //Buy Tokens
        const _buyAmt = ethers.utils.parseEther("1");
        const _purchaseReturn = await mintTokens(testBancorFormula, (constants.initialTokenSupply).sub(_sellAmount), (constants.initialSecondaryReserveBalance).sub(_expectedSaleReturn), (constants.initialSecondaryReserveRatio), _buyAmt);
        const _initialBalanceBuyer = await vaultContract.balanceOf(await buyer1.getAddress());
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmt });
        expect((await vaultContract.balanceOf(await buyer1.getAddress())).sub(_initialBalanceBuyer)).to.equal(_purchaseReturn);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_initialSecondaryBalance.add(_buyAmt));
    })

    it("should not buy tokens on primary curve if amtOut low", async function () { 
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
       const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = (await mintTokens(testBancorFormula,
                                                constants.initialTokenSupply,
                                                constants.initialPrimaryReserveBalance,
                                                constants.primaryReserveRatio,
                                                _buyAmountWithFee)).mul(TWO);
        await expect(vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount })).to.be.revertedWith("NibblVault: Return too low");
    });

    it("should not buy tokens successfully on multi curve", async function () {
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        //Selling Tokens
        const _sellAmount = (constants.initialTokenSupply).div(5); //Selling 1/5th the amount i.e 200k here
        const _expectedSaleReturn = await burnTokens(
                                                    testBancorFormula,
                                                    constants.initialTokenSupply,
                                                    constants.initialSecondaryReserveBalance,
                                                    constants.initialSecondaryReserveRatio,
                                                    _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await curator.getAddress());
        //---------------- 1/5th Tokens Sold ----------------        
        //Buy Tokens
        const _buyAmtTotal = ethers.utils.parseEther("20");
        const _buyAmtSecCurve = _expectedSaleReturn; //secondaryCurve doesn't have any fee so exact amount
        const _purchaseReturnSecCurve = _sellAmount;
        
        const _buyAmtPrimaryCurve = _buyAmtTotal.sub(_buyAmtSecCurve);
        const _buyAmtPrimaryWithFee = _buyAmtPrimaryCurve.sub(_buyAmtPrimaryCurve.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturnPrimaryCurve = await mintTokens(testBancorFormula, constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmtPrimaryWithFee);        
        // Primary curve goes up from initialSupply. Therefore, constant.initialTokenSupply is used as continuousTokenSupply.

        await expect(vaultContract.connect(buyer1).buy(_purchaseReturnPrimaryCurve.add(_purchaseReturnSecCurve).mul(TWO), await buyer1.getAddress(), { value: _buyAmtTotal })).to.be.revertedWith("NibblVault: Return too low");
    })
    
    it("should not buy tokens on secondary curve if amtOut low", async function () { 
        //Selling Tokens
        const _sellAmount = constants.initialTokenSupply.sub(constants.initialTokenSupply.div(4)); //Selling 1/5th the amount i.e 200k here
        const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await curator.getAddress());
        //---------------- 3/4th Tokens Sold ----------------        
        //Buy Tokens
        const _buyAmt = ethers.utils.parseEther("1");
        const _purchaseReturn = (await mintTokens(testBancorFormula, (constants.initialTokenSupply).sub(_sellAmount), (constants.initialSecondaryReserveBalance).sub(_expectedSaleReturn), (constants.initialSecondaryReserveRatio), _buyAmt)).mul(TWO);
         await expect(vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmt })).to.be.revertedWith("NibblVault: Return too low");
    });

    it("should sell tokens successfully from primary curve", async function () {
        // Buy Tokens 
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula, constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
        let _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        let _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURVE)).div(constants.SCALE));
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecBalance);
        expect(await vaultContract.totalSupply()).to.equal(constants.initialTokenSupply.add(_purchaseReturn));
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
        expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_buyAmount.mul(constants.FEE_ADMIN)).div(constants.SCALE));        
        expect(await vaultContract.secondaryReserveRatio()).to.equal((_newSecBalance.mul(constants.SCALE)).div(constants.initialValuation));        
        expect(await vaultContract.feeAccruedCurator()).to.equal((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));        
        // ------------------Tokens Bought----------------
        // Sell Tokens
        const _feeAccruedInitial = await vaultContract.feeAccruedCurator();
        const _sellAmount = _purchaseReturn.div(2); //Only selling half the amount bought
        const _sellReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply.add(_purchaseReturn),  _initialPrimaryBalance.add(_buyAmountWithFee), constants.primaryReserveRatio, _sellAmount);
        const _sellReturnWithFee = _sellReturn.sub(_sellReturn.mul(_feeTotal).div(constants.SCALE));
        _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        await vaultContract.connect(buyer1).sell(_sellAmount, _sellReturnWithFee, await buyer1.getAddress());
        expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_sellReturn.mul(constants.FEE_ADMIN)).div(constants.SCALE));        
        expect(await vaultContract.totalSupply()).to.equal(constants.initialTokenSupply.add(_purchaseReturn).sub(_sellAmount));
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn.sub(_sellAmount));
        expect((await vaultContract.feeAccruedCurator()).sub(_feeAccruedInitial)).to.equal((_sellReturn.mul(constants.FEE_CURATOR)).div(constants.SCALE));
        expect(await vaultContract.secondaryReserveRatio()).to.equal((_newSecBalance.add(_sellReturn.mul(constants.FEE_CURVE).div(constants.SCALE))).mul(constants.SCALE).div(constants.initialValuation));        
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecBalance.add(_sellReturn.mul(constants.FEE_CURVE).div(constants.SCALE)));        
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee).sub(_sellReturn));        
    })

    it("should sell tokens successfully on secondary curve", async function () {
        const _sellAmount = (constants.initialTokenSupply).div(5);
        let _balanceAddr1 = await addr1.provider.getBalance(await addr1.getAddress());
        const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
        await vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await addr1.getAddress());
        expect(await vaultContract.balanceOf(await curator.getAddress())).to.equal((constants.initialTokenSupply).sub(_sellAmount));
        expect((await addr1.provider.getBalance(await addr1.getAddress())).sub(_balanceAddr1)).to.equal((_expectedSaleReturn));        
        expect(await vaultContract.secondaryReserveBalance()).to.equal((constants.initialSecondaryReserveBalance).sub(_expectedSaleReturn));
        expect(await vaultContract.totalSupply()).to.equal((constants.initialTokenSupply).sub(_sellAmount));
    })

    it("should sell tokens successfully on multi curve", async function () {
        await vaultContract.connect(curator).transfer(await buyer1.getAddress(), constants.initialTokenSupply); //Transfer all tokens to buyer
        const _buyAmount = ethers.utils.parseEther("5");
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula,
                                                constants.initialTokenSupply,
                                                constants.initialPrimaryReserveBalance,
                                                constants.primaryReserveRatio,
                                                _buyAmountWithFee);
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal((constants.initialTokenSupply).add(_purchaseReturn));
        ///--------Bought Tokens --------------//
        // Sell Tokens        
        const _balanceAddr1Initial = await addr1.provider.getBalance(await addr1.getAddress());
        const _initialPrimaryBalance = (constants.initialPrimaryReserveBalance).add(_buyAmountWithFee);
        const _sellAmount = (constants.initialTokenSupply).div(2); //Only selling half the amount bought initially 500k
        const _totalSupplyInitial = (constants.initialTokenSupply).add(_purchaseReturn);
        const _expectedSaleReturnPrimary = _initialPrimaryBalance.sub((constants.initialPrimaryReserveBalance));        
        const _expectedSaleReturnPrimaryWithFee = _expectedSaleReturnPrimary.sub(_expectedSaleReturnPrimary.mul(_feeTotal).div(constants.SCALE));
        const newSecResBal = (constants.initialSecondaryReserveBalance).add(_expectedSaleReturnPrimary.mul(constants.FEE_CURVE).div(constants.SCALE)).add(_buyAmount.mul(constants.FEE_CURVE).div(constants.SCALE));
        const newSecResRatio = newSecResBal.mul(constants.SCALE).div(constants.initialValuation);
        const _expectedSaleReturnSecondary = await burnTokens(testBancorFormula, _totalSupplyInitial.sub(_purchaseReturn), newSecResBal, newSecResRatio, _sellAmount.sub(_purchaseReturn));        
        await vaultContract.connect(buyer1).sell(_sellAmount, _expectedSaleReturnPrimaryWithFee.add(_expectedSaleReturnSecondary), await addr1.getAddress());
        const _balanceAddr1Final = await addr1.provider.getBalance(await addr1.getAddress());
        expect(_balanceAddr1Final.sub(_balanceAddr1Initial)).to.equal(_expectedSaleReturnPrimaryWithFee.add(_expectedSaleReturnSecondary));        
    });

    it("should not sell tokens on primary curve if return amt low", async function () {
        // Buy Tokens 
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = constants.FEE_ADMIN.add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _initialSecondaryBalance = await vaultContract.secondaryReserveBalance();
        const _initialPrimaryBalance = await vaultContract.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula, constants.initialTokenSupply, constants.initialPrimaryReserveBalance, constants.primaryReserveRatio, _buyAmountWithFee);
        let _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        let _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(constants.FEE_CURVE)).div(constants.SCALE));
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal(_purchaseReturn);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(_newSecBalance);
        expect(await vaultContract.totalSupply()).to.equal(constants.initialTokenSupply.add(_purchaseReturn));
        expect(await vaultContract.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
        expect((await admin.provider.getBalance(vaultFactoryContract.address)).sub(_initialBalanceFactory)).to.equal((_buyAmount.mul(constants.FEE_ADMIN)).div(constants.SCALE));        
        expect(await vaultContract.secondaryReserveRatio()).to.equal((_newSecBalance.mul(constants.SCALE)).div(constants.initialValuation));        
        expect(await vaultContract.feeAccruedCurator()).to.equal((_buyAmount.mul(constants.FEE_CURATOR)).div(constants.SCALE));        
        // ------------------Tokens Bought----------------
        // Sell Tokens
        const _sellAmount = _purchaseReturn.div(2); //Only selling half the amount bought
        const _sellReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply.add(_purchaseReturn),  _initialPrimaryBalance.add(_buyAmountWithFee), constants.primaryReserveRatio, _sellAmount);
        const _sellReturnWithFee = (_sellReturn.sub(_sellReturn.mul(_feeTotal).div(constants.SCALE))).mul(TWO);
        _initialBalanceFactory = await admin.provider.getBalance(vaultFactoryContract.address);
        await expect(vaultContract.connect(buyer1).sell(_sellAmount, _sellReturnWithFee, await buyer1.getAddress())).to.be.revertedWith("NibblVault: Return too low");
    })


    it("should not sell tokens successfully on secondary curve is return too low", async function () {
        const _sellAmount = (constants.initialTokenSupply).div(5);
        const _expectedSaleReturn = (await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount)).mul(TWO);
        await expect(vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, await addr1.getAddress())).to.be.revertedWith("NibblVault: Return too low");
     })

    it("should not sell tokens successfully on multi curve if return too low", async function () {
        await vaultContract.connect(curator).transfer(await buyer1.getAddress(), constants.initialTokenSupply); //Transfer all tokens to buyer
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = (constants.FEE_ADMIN).add(constants.FEE_CURATOR).add(constants.FEE_CURVE);
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(constants.SCALE));
        const _purchaseReturn = await mintTokens(testBancorFormula,
                                                constants.initialTokenSupply,
                                                constants.initialPrimaryReserveBalance,
                                                constants.primaryReserveRatio,
                                                _buyAmountWithFee);
        await vaultContract.connect(buyer1).buy(_purchaseReturn, await buyer1.getAddress(), { value: _buyAmount });
        expect(await vaultContract.balanceOf(await buyer1.getAddress())).to.equal((constants.initialTokenSupply).add(_purchaseReturn));
        ///--------Bought Tokens --------------//
        // Sell Tokens        
        const _initialPrimaryBalance = (constants.initialPrimaryReserveBalance).add(_buyAmountWithFee);
        const _sellAmount = ((constants.initialTokenSupply).add(_purchaseReturn)).div(2); //Only selling half the amount bought initially 500k
        const _totalSupplyInitial = (constants.initialTokenSupply).add(_purchaseReturn);
        const _expectedSaleReturnPrimary = _initialPrimaryBalance.sub((constants.initialPrimaryReserveBalance));        
        const _expectedSaleReturnPrimaryWithFee = _expectedSaleReturnPrimary.sub(_expectedSaleReturnPrimary.mul(_feeTotal).div(constants.SCALE));
        const newSecResBal = (constants.initialSecondaryReserveBalance).add(_expectedSaleReturnPrimary.mul(constants.FEE_CURVE).div(constants.SCALE)).add(_buyAmount.mul(constants.FEE_CURVE).div(constants.SCALE));
        const newSecResRatio = newSecResBal.mul(constants.SCALE).div(constants.initialValuation);
        const _expectedSaleReturnSecondary = await burnTokens(testBancorFormula, _totalSupplyInitial.sub(_purchaseReturn), newSecResBal, newSecResRatio, _sellAmount.sub(_purchaseReturn));        
        await expect(vaultContract.connect(buyer1).sell(_sellAmount, (_expectedSaleReturnPrimaryWithFee.add(_expectedSaleReturnSecondary)).mul(TWO), await addr1.getAddress())).to.be.revertedWith("NibblVault: Return too low");
    });

});