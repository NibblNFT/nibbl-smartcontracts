import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { unlockReservedLiquidity, mintTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { type } from 'os';


describe('NibblTokenVault', function () {
    
    const tokenName = "NibblToken";
    const tokenSymbol = "NIBBL";
    const assetName = "NFT";
    const assetSymbol = "NFT";
    const scale: number = 1e6;
    const feeAdmin: number = .003;
    const feeCurator: number = .007;
    const rejectionPremium: number =.1;
    const reserveRatio: number = .5;
    

    const initialTokenPrice: number = 0.0001; //10 ^-4
    const initialValuation: number = 100;
    const reservedTokenSupply: number = initialValuation / initialTokenPrice;
    const initialFictitiousReserveBalance: number = reserveRatio * initialValuation;

    const ONE = BigNumber.from((1));
    const decimal = BigNumber.from((10 ** 18).toString());    

    beforeEach(async function () {
        const [curator, admin ,addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();
        this.curator = curator;
        this.admin = admin;
        this.addr1 = addr1;
        this.addr2 = addr2;
        this.addr3 = addr3;
        this.addr4 = addr4;
        this.addr5 = addr5;

        this.NFT = await ethers.getContractFactory("NFT");
        this.nft = await this.NFT.deploy();
        await this.nft.deployed();
        this.nft.mint(this.curator.address, 0);

        this.SingleCurveVault = await ethers.getContractFactory("SingleCurveVault");
        this.singleCurveVaultImplementation = await this.SingleCurveVault.deploy();
        await this.singleCurveVaultImplementation.deployed();
        
        this.TokenVaultFactory = await ethers.getContractFactory("NibblTokenVaultFactory");
        this.tokenVaultFactory = await this.TokenVaultFactory.deploy(
            this.singleCurveVaultImplementation.address,
            BigNumber.from(reserveRatio * scale),
            BigNumber.from(feeAdmin * scale),
            BigNumber.from(feeCurator * scale),
            BigNumber.from(rejectionPremium * scale));
        await this.tokenVaultFactory.deployed();
        this.nft.approve(this.tokenVaultFactory.address, 0);
            
        
        // console.log(unlockedTokens, reservedTokenSupply, initialFictitiousReserveBalance , reserveRatio, initialLiquiditySupplied);
        
        // const mintedTokens: number = mintTokens(reservedTokenSupply - unlockedTokens, initialFictitiousReserveBalance - initialLiquiditySupplied, reserveRatio, initialLiquiditySupplied);
        // console.log(mintedTokens, reservedTokenSupply - unlockedTokens, initialFictitiousReserveBalance- initialLiquiditySupplied ,reserveRatio, initialLiquiditySupplied);        


    })
    

    it("should initialize the vault with correct initial values when (initialLiquiditySupplied != 0).", async function () {
        const initialLiquiditySupplied: number = 25;
        const unlockedTokens: BigNumber = BigNumber.from((unlockReservedLiquidity(reservedTokenSupply, initialFictitiousReserveBalance , reserveRatio, initialLiquiditySupplied) * 1e18).toLocaleString('fullwide', {useGrouping:false}));
        //
        await this.tokenVaultFactory.createSingleCurveVault(this.nft.address, 0, tokenName, tokenSymbol, BigNumber.from((reservedTokenSupply).toString()).mul(decimal), unlockedTokens, { value: BigNumber.from((initialLiquiditySupplied).toString()).mul(decimal)  });
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.SingleCurveVault.interface, this.curator);
        // 
        expect(await this.tokenVault.name()).to.equal(tokenName);
        expect(await this.tokenVault.symbol()).to.equal(tokenSymbol);
        expect(await this.tokenVault.curator()).to.equal(this.curator.address);
        expect(await this.tokenVault.status()).to.equal(1);        
        expect((await this.tokenVault.asset()).assetAddress).to.equal(this.nft.address);
        expect((await this.tokenVault.asset()).assetTokenID).to.equal(0);
        expect((await this.tokenVault.fee()).feeAdmin).to.equal(feeAdmin * scale);
        expect((await this.tokenVault.fee()).feeCurator).to.equal(feeCurator * scale);
        expect(await this.tokenVault.reserveRatio()).to.equal(reserveRatio * scale);
        expect(await this.tokenVault.rejectionPremium()).to.equal(rejectionPremium * scale);
        expect(await this.tokenVault.reservedContinousSupply()).lte((BigNumber.from(reservedTokenSupply).mul(decimal)).sub(unlockedTokens));
        expect(await this.tokenVault.fictitiousReserveBalance()).to.equal((BigNumber.from(initialFictitiousReserveBalance).mul(decimal)).sub(BigNumber.from(initialLiquiditySupplied).mul(decimal)));
        expect(await this.tokenVault.reserveBalance()).to.equal(BigNumber.from(initialLiquiditySupplied).mul(decimal));
        expect(await this.nft.ownerOf(0)).to.equal(this.tokenVault.address);
        expect(await this.tokenVault.balanceOf(this.curator.address)).to.equal((BigNumber.from(reservedTokenSupply).mul(decimal)).sub((await this.tokenVault.reservedContinousSupply())));
    })


    it("should initialize the vault with correct initial values when (initialLiquiditySupplied == 0).", async function () {
        const initialLiquiditySupplied: number = 0;
        const unlockedTokens: BigNumber = BigNumber.from((unlockReservedLiquidity(reservedTokenSupply, initialFictitiousReserveBalance , reserveRatio, initialLiquiditySupplied) * 1e18).toLocaleString('fullwide', {useGrouping:false}));
        //
        await this.tokenVaultFactory.createSingleCurveVault(this.nft.address, 0, tokenName, tokenSymbol, BigNumber.from((reservedTokenSupply).toString()).mul(decimal), unlockedTokens, { value: BigNumber.from((initialLiquiditySupplied).toString()).mul(decimal)  });
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.SingleCurveVault.interface, this.curator);
        // 
        expect(await this.tokenVault.name()).to.equal(tokenName);
        expect(await this.tokenVault.symbol()).to.equal(tokenSymbol);
        expect(await this.tokenVault.curator()).to.equal(this.curator.address);
        expect(await this.tokenVault.status()).to.equal(1);
        expect((await this.tokenVault.asset()).assetAddress).to.equal(this.nft.address);
        expect((await this.tokenVault.asset()).assetTokenID).to.equal(0);
        expect((await this.tokenVault.fee()).feeAdmin).to.equal(feeAdmin * scale);
        expect((await this.tokenVault.fee()).feeCurator).to.equal(feeCurator * scale);
        expect(await this.tokenVault.reserveRatio()).to.equal(reserveRatio * scale);
        expect(await this.tokenVault.reserveRatio()).to.equal(reserveRatio * scale);
        expect(await this.tokenVault.rejectionPremium()).to.equal(rejectionPremium * scale);
        expect(await this.tokenVault.reservedContinousSupply()).lte((BigNumber.from(reservedTokenSupply).mul(decimal)).sub(unlockedTokens));
        expect(await this.tokenVault.fictitiousReserveBalance()).to.equal((BigNumber.from(initialFictitiousReserveBalance).mul(decimal)).sub(BigNumber.from(initialLiquiditySupplied).mul(decimal)));
        expect(await this.tokenVault.reserveBalance()).to.equal(BigNumber.from(initialLiquiditySupplied).mul(decimal));
        expect(await this.nft.ownerOf(0)).to.equal(this.tokenVault.address);
        expect(await this.tokenVault.balanceOf(this.curator.address)).to.equal((BigNumber.from(reservedTokenSupply).mul(decimal)).sub((await this.tokenVault.reservedContinousSupply())));

    })


    it("should initialize the vault with correct initial values when (initialLiquiditySupplied == initialFictitiousReserveBalance).", async function () {
        const initialLiquiditySupplied: number = initialFictitiousReserveBalance;
        const unlockedTokens: BigNumber = BigNumber.from((unlockReservedLiquidity(reservedTokenSupply, initialFictitiousReserveBalance , reserveRatio, initialLiquiditySupplied) * 1e18).toLocaleString('fullwide', {useGrouping:false}));
        //
        await this.tokenVaultFactory.createSingleCurveVault(this.nft.address, 0, tokenName, tokenSymbol, BigNumber.from((reservedTokenSupply).toString()).mul(decimal), unlockedTokens, { value: BigNumber.from((initialLiquiditySupplied).toString()).mul(decimal)  });
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.SingleCurveVault.interface, this.curator);
        // 
        expect(await this.tokenVault.name()).to.equal(tokenName);
        expect(await this.tokenVault.symbol()).to.equal(tokenSymbol);
        expect(await this.tokenVault.curator()).to.equal(this.curator.address);
        expect(await this.tokenVault.status()).to.equal(1);
        expect((await this.tokenVault.asset()).assetAddress).to.equal(this.nft.address);
        expect((await this.tokenVault.asset()).assetTokenID).to.equal(0);
        expect((await this.tokenVault.fee()).feeAdmin).to.equal(feeAdmin * scale);
        expect((await this.tokenVault.fee()).feeCurator).to.equal(feeCurator * scale);
        expect(await this.tokenVault.reserveRatio()).to.equal(reserveRatio * scale);
        expect(await this.tokenVault.reserveRatio()).to.equal(reserveRatio * scale);
        expect(await this.tokenVault.rejectionPremium()).to.equal(rejectionPremium * scale);
        expect(await this.tokenVault.reservedContinousSupply()).equal((BigNumber.from(0).mul(decimal)));
        expect(await this.tokenVault.fictitiousReserveBalance()).to.equal((BigNumber.from(0).mul(decimal)));
        expect(await this.tokenVault.reserveBalance()).to.equal(BigNumber.from(initialLiquiditySupplied).mul(decimal));
        expect(await this.tokenVault.reserveBalance()).to.equal(BigNumber.from(initialFictitiousReserveBalance).mul(decimal));
        expect(await this.nft.ownerOf(0)).to.equal(this.tokenVault.address);
        expect(await this.tokenVault.balanceOf(this.curator.address)).to.equal((BigNumber.from((reservedTokenSupply * 1e18).toLocaleString('fullwide', {useGrouping:false}))));

    })

    it("should unlock reserved liquidity partially.", async function () {
        //
        const initialLiquiditySupplied: number = 0;
        await this.tokenVaultFactory.createSingleCurveVault(this.nft.address, 0, tokenName, tokenSymbol, BigNumber.from((reservedTokenSupply).toString()).mul(decimal), 0, { value: BigNumber.from((initialLiquiditySupplied).toString()).mul(decimal)  });
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.SingleCurveVault.interface, this.curator);
        // 
        const liquiditySupplied: number = 20;
        let unlockedTokens: BigNumber = BigNumber.from((unlockReservedLiquidity(reservedTokenSupply, initialFictitiousReserveBalance , reserveRatio, initialLiquiditySupplied) * 1e18).toLocaleString('fullwide', {useGrouping:false}));
        await this.tokenVault.unlockReservedSupply(unlockedTokens, {value: BigNumber.from(liquiditySupplied).mul(decimal)});
        expect(await this.tokenVault.reservedContinousSupply()).lte((BigNumber.from(reservedTokenSupply).mul(decimal)).sub(unlockedTokens));
        expect(await this.tokenVault.balanceOf(this.curator.address)).to.equal((BigNumber.from(reservedTokenSupply).mul(decimal)).sub(await this.tokenVault.reservedContinousSupply()));
    })

    it("should unlock complete reserved liquidity.", async function () {
        //
        const initialLiquiditySupplied: number = 0;
        await this.tokenVaultFactory.createSingleCurveVault(this.nft.address, 0, tokenName, tokenSymbol, BigNumber.from((reservedTokenSupply).toString()).mul(decimal), 0, { value: BigNumber.from((initialLiquiditySupplied).toString()).mul(decimal)  });
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.SingleCurveVault.interface, this.curator);
        // 
        let unlockedTokens: BigNumber = BigNumber.from((unlockReservedLiquidity(reservedTokenSupply, initialFictitiousReserveBalance , reserveRatio, initialFictitiousReserveBalance) * 1e18).toLocaleString('fullwide', {useGrouping:false}));
        await this.tokenVault.unlockReservedSupply(unlockedTokens, {value: BigNumber.from(initialFictitiousReserveBalance).mul(decimal)});
        expect(await this.tokenVault.reservedContinousSupply()).to.equal(0);
        expect(await this.tokenVault.balanceOf(this.curator.address)).to.equal((BigNumber.from(reservedTokenSupply).mul(decimal)));
    })


   it("should unlock reserved liquidity partially.", async function () {
        //
        const initialLiquiditySupplied: number = 10;
        await this.tokenVaultFactory.createSingleCurveVault(this.nft.address, 0, tokenName, tokenSymbol, BigNumber.from((reservedTokenSupply).toString()).mul(decimal), 0, { value: BigNumber.from((initialLiquiditySupplied).toString()).mul(decimal)  });
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.SingleCurveVault.interface, this.curator);
        // 
        const liquiditySupplied: number = 20;
        let unlockedTokens: BigNumber = BigNumber.from((unlockReservedLiquidity(reservedTokenSupply, initialFictitiousReserveBalance , reserveRatio, initialLiquiditySupplied) * 1e18).toLocaleString('fullwide', {useGrouping:false}));
        await this.tokenVault.unlockReservedSupply(unlockedTokens, {value: BigNumber.from(liquiditySupplied).mul(decimal)});
        expect(await this.tokenVault.reservedContinousSupply()).lte((BigNumber.from(reservedTokenSupply).mul(decimal)).sub(unlockedTokens));
        expect(await this.tokenVault.balanceOf(this.curator.address)).to.equal((BigNumber.from(reservedTokenSupply).mul(decimal)).sub(await this.tokenVault.reservedContinousSupply()));
    })

})