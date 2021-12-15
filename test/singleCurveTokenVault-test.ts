import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { mintTokens, burnTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { log } from 'console';

describe('NibblTokenVault', function () {
    
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
    const initialReserveBalance: BigNumber = ethers.utils.parseEther("10");
    const requiredReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
    const secondaryReserveRatio: BigNumber = initialReserveBalance.mul(SCALE).div(initialValuation);
    const primaryReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);    

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
        this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
        await this.testBancorBondingCurve.deployed();
        
        await this.tokenVaultFactory.createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply, {value: initialReserveBalance});
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.NibblVault.interface, this.curator);
    })
    
    it("should initialize the vault with correct initial values", async function () {
        expect(await this.tokenVault.name()).to.equal(tokenName);
        expect(await this.tokenVault.symbol()).to.equal(tokenSymbol);
        expect(await this.tokenVault.curator()).to.equal(this.curator.address);
        expect(await this.tokenVault.status()).to.equal(0);        
        expect(await this.tokenVault.assetAddress()).to.equal(this.nft.address);
        expect(await this.tokenVault.assetID()).to.equal(0);
        expect(await this.tokenVault.initialTokenSupply()).to.equal(initialTokenSupply);
        expect(await this.tokenVault.secondaryReserveBalance()).to.equal(initialReserveBalance);
        expect(await this.tokenVault.secondaryReserveRatio()).to.equal(secondaryReserveRatio);
        expect(await this.tokenVault.primaryReserveBalance()).to.equal(primaryReserveBalance);
    })

    it("should buy tokens successfully from primary curve", async function () {
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);
        const _initialSecondaryBalance = await this.tokenVault.secondaryReserveBalance();
        const _initialPrimaryBalance = await this.tokenVault.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(SCALE));
        const _purchaseReturn = await mintTokens(this.testBancorBondingCurve, initialTokenSupply, primaryReserveBalance, primaryReserveRatio, _buyAmountWithFee);
        const _initialBalanceAdmin = await this.admin.provider.getBalance(this.admin.address);
        const _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(FEE_CURATOR)).div(SCALE));
        await this.tokenVault.connect(this.buyer1).buy(_purchaseReturn, this.buyer1.address, { value: _buyAmount });
        expect(await this.tokenVault.balanceOf(this.buyer1.address)).to.equal(_purchaseReturn);
        expect(await this.tokenVault.secondaryReserveBalance()).to.equal(_newSecBalance);
        expect(await this.tokenVault.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
        expect((await this.admin.provider.getBalance(this.admin.address)).sub(_initialBalanceAdmin)).to.equal((_buyAmount.mul(FEE_ADMIN)).div(SCALE));        
        expect(await this.tokenVault.secondaryReserveRatio()).to.equal((_newSecBalance.mul(SCALE)).div(initialValuation));        
        expect(await this.tokenVault.feeAccruedCurator()).to.equal((_buyAmount.mul(FEE_CURATOR)).div(SCALE));        
    })

    it("should sell tokens successfully from primary curve", async function () {
        // Buy Tokens 
        const _buyAmount = ethers.utils.parseEther("1");
        const _feeTotal = FEE_ADMIN.add(FEE_CURATOR).add(FEE_CURVE);
        const _initialSecondaryBalance = await this.tokenVault.secondaryReserveBalance();
        const _initialPrimaryBalance = await this.tokenVault.primaryReserveBalance();
        const _buyAmountWithFee = _buyAmount.sub(_buyAmount.mul(_feeTotal).div(SCALE));
        const _purchaseReturn = await mintTokens(this.testBancorBondingCurve, initialTokenSupply, primaryReserveBalance, primaryReserveRatio, _buyAmountWithFee);
        let _balanceAdmin = await this.admin.provider.getBalance(this.admin.address);
        let _newSecBalance = _initialSecondaryBalance.add((_buyAmount.mul(FEE_CURVE)).div(SCALE));
        await this.tokenVault.connect(this.buyer1).buy(_purchaseReturn, this.buyer1.address, { value: _buyAmount });
        expect(await this.tokenVault.balanceOf(this.buyer1.address)).to.equal(_purchaseReturn);
        expect(await this.tokenVault.secondaryReserveBalance()).to.equal(_newSecBalance);
        expect(await this.tokenVault.totalSupply()).to.equal(initialTokenSupply.add(_purchaseReturn));
        expect(await this.tokenVault.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee));
        expect((await this.admin.provider.getBalance(this.admin.address)).sub(_balanceAdmin)).to.equal((_buyAmount.mul(FEE_ADMIN)).div(SCALE));        
        expect(await this.tokenVault.secondaryReserveRatio()).to.equal((_newSecBalance.mul(SCALE)).div(initialValuation));        
        expect(await this.tokenVault.feeAccruedCurator()).to.equal((_buyAmount.mul(FEE_CURATOR)).div(SCALE));        
        // ------------------Tokens Bought----------------
        // Sell Tokens
        const _feeAccruedInitial = await this.tokenVault.feeAccruedCurator();
        const _sellAmount = _purchaseReturn.div(2); //Only selling half the amount bought
        const _sellReturn = await burnTokens(this.testBancorBondingCurve, initialTokenSupply.add(_purchaseReturn),  _initialPrimaryBalance.add(_buyAmountWithFee), primaryReserveRatio, _sellAmount);
        const _sellReturnWithFee = _sellReturn.sub(_sellReturn.mul(_feeTotal).div(SCALE));
        _balanceAdmin = await this.admin.provider.getBalance(this.admin.address);        
        await this.tokenVault.connect(this.buyer1).sell(_sellAmount, _sellReturnWithFee, this.buyer1.address);
        expect((await this.admin.provider.getBalance(this.admin.address)).sub(_balanceAdmin)).to.equal((_sellReturn.mul(FEE_ADMIN)).div(SCALE));        
        expect(await this.tokenVault.totalSupply()).to.equal(initialTokenSupply.add(_purchaseReturn).sub(_sellAmount));
        expect(await this.tokenVault.balanceOf(this.buyer1.address)).to.equal(_purchaseReturn.sub(_sellAmount));
        expect((await this.tokenVault.feeAccruedCurator()).sub(_feeAccruedInitial)).to.equal((_sellReturn.mul(FEE_CURATOR)).div(SCALE));
        expect(await this.tokenVault.secondaryReserveRatio()).to.equal((_newSecBalance.add(_sellReturn.mul(FEE_CURVE).div(SCALE))).mul(SCALE).div(initialValuation));        
        expect(await this.tokenVault.secondaryReserveBalance()).to.equal(_newSecBalance.add(_sellReturn.mul(FEE_CURVE).div(SCALE)));        
        expect(await this.tokenVault.primaryReserveBalance()).to.equal(_initialPrimaryBalance.add(_buyAmountWithFee).sub(_sellReturn));        

    })



})
