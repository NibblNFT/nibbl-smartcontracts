import { expect } from 'chai';
import { ethers,network } from 'hardhat';
import { BigNumber } from 'ethers';
import { mintTokens, burnTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime } from "./testHelpers/time";

describe('NibblTokenVault', function () {
    
    type TwavObservation =  {
        timestamp: BigNumber;
        cumulativeValuation: BigNumber;
    }
    const tokenName = "NibblToken";
    const tokenSymbol = "NIBBL";
    const SCALE: BigNumber = BigNumber.from(1e6);
    const ONE = BigNumber.from((1));
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
    const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
    const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
    const requiredReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
    const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
    const primaryReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);    
    const fictitiousPrimaryReserveBalance = primaryReserveRatio.mul(initialValuation).div(SCALE);
    
        // (primaryReserveRatio * initialTokenSupply * INITIAL_TOKEN_PRICE) / (SCALE * 1e18);

    beforeEach(async function () {        
        const [curator, admin ,buyer1, addr1, addr2, addr3, addr4] = await ethers.getSigners();
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
        
        this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
        this.tokenVaultFactory = await this.NibblVaultFactory.deploy(this.nibblVaultImplementation.address, this.admin.address);
        await this.tokenVaultFactory.deployed();
        this.nft.approve(this.tokenVaultFactory.address, 0);

        this.TestBancorBondingCurve = await ethers.getContractFactory("TestBancorBondingCurve");
        this.TestTWAPContract = await ethers.getContractFactory("TestTwav");
        this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
        this.testTWAV = await this. TestTWAPContract.deploy()
        await this.testTWAV.deployed()
        await this.testBancorBondingCurve.deployed();
        
        await this.tokenVaultFactory.createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply, {value: initialSecondaryReserveBalance});
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.NibblVault.interface, this.curator);
    })

    it("should update twav array", async function () {
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);
        const _initialSecondaryBalance = await this.tokenVault.secondaryReserveBalance();
        const _initialPrimaryBalance = await this.tokenVault.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(SCALE));
        const _purchaseReturn = await mintTokens(this.testBancorBondingCurve, initialTokenSupply, primaryReserveBalance, primaryReserveRatio, _buyAmountWithFee);
        const _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(FEE_CURVE)).div(SCALE));
        const _newSecRatio = _newSecBalance.mul(SCALE).div(initialValuation);
        const _newPrimaryReserveBalance = _initialPrimaryBalance.add(_buyAmountWithFee);
        await this.tokenVault.connect(this.buyer1).buy(_purchaseReturn, this.buyer1.address, { value: _buyAmount });
        expect(await this.tokenVault.secondaryReserveBalance()).to.equal(_newSecBalance);
        expect(await this.tokenVault.primaryReserveBalance()).to.equal(_newPrimaryReserveBalance);
        expect(await this.tokenVault.secondaryReserveRatio()).to.equal(_newSecRatio);
        const _observation = await this.tokenVault.twavObservations(BigNumber.from(await this.tokenVault.twavObservationsIndex()).sub(ONE));
        expect(_observation.cumulativeValuation).to.equal((_observation.timestamp).mul(initialValuation));
        await network.provider.send("evm_increaseTime", [3600])
        const _valuation: BigNumber = (_newSecBalance.mul(SCALE).div(_newSecRatio)).add((_newPrimaryReserveBalance.sub(fictitiousPrimaryReserveBalance)).mul(SCALE).div(primaryReserveRatio));  
        // console.log("valuation", _valuation);
        // for(let i = 0;i<25;i++){
        //     await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
        //     for(let i = 0;i<12;i++){
        //         let obs = await this.tokenVault.twavObservations(i)
        //         console.log("element number",i," cummulative valuation:",obs.cumulativeValuation)
        //     }
        //     let weightedValuation = await this.tokenVault._getTwav()        
        //     console.log("weighted valutaion",weightedValuation,"after ",i+2," transactions\n")
        // }
        const _observation2 = await this.tokenVault.twavObservations(BigNumber.from(await this.tokenVault.twavObservationsIndex()).sub(ONE));
        expect(_observation2.cumulativeValuation).to.equal(_observation.cumulativeValuation.add(_valuation.mul((_observation2.timestamp-_observation.timestamp))))
    })
    it("should compute correct twav", async function () {
        const initialValutaion = 100; //100 ETH
        const iterations = 15
        let initialValuationArray = [];
        const initialTimestamp = (new Date().getTime()) / 1000 
        for(let i = 0;i<iterations;i++){
            const valuation = initialValutaion + i
            initialValuationArray.push(ethers.utils.parseEther(`${valuation}`))
            let fakeTimestamp = initialTimestamp + (i * 3600)
            await this.testTWAV._updateTWAV(initialValuationArray[i],fakeTimestamp.toFixed(0))
            const twav = await this.testTWAV._getTwav()
        }
        const twav = await this.testTWAV._getTwav()
        const expectedTWAV =  ethers.utils.parseEther(`${194}`)
        expect(twav).to.equal(expectedTWAV)
    })

})
