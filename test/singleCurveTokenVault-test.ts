import { expect } from 'chai';
import { ethers } from 'hardhat';


describe('NibblTokenVault', function () {
    
    const tokenName = "NibblToken";
    const tokenSymbol = "NIBBL";
    const scale = ethers.BigNumber.from(1e6);
    const fee = ethers.BigNumber.from(.01e6);
    const rejectionPremium = ethers.BigNumber.from(.1e6);
    const reserveRatio = ethers.BigNumber.from(.5e6);
    const initialTokenPrice = ethers.BigNumber.from(1e14); //10 ^-4
    const initialValuation = ethers.BigNumber.from(200e18.toString());
    const initialTokenSupply = ethers.BigNumber.from(initialValuation.div(initialTokenPrice));
    const initialReserveBalance = ethers.BigNumber.from((10e18).toString());
    const ONE = ethers.BigNumber.from((1));

    beforeEach(async function () {
        const [curator, addr1, addr2, addr3, addr4, addr5] = await ethers.getSigners();
        this.curator = curator;
        this.addr1 = addr1;
        this.addr2 = addr2;
        this.addr3 = addr3;
        this.addr4 = addr4;
        this.addr5 = addr5;
        this.ownerPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
        this.addr1PrivateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

        const NFT = await ethers.getContractFactory("NFT");
        this.nft = await NFT.deploy();
        await this.nft.deployed();
        this.nft.mint(this.curator.address, 0);

        const SingleCurveNibblVault = await ethers.getContractFactory("SingleCurveNibblVault");
        this.singleCurveVaultImplementation = await SingleCurveNibblVault.deploy();
        await this.singleCurveVaultImplementation.deployed();

        const TokenVaultFactory = await ethers.getContractFactory("NibblTokenVaultFactory");
        this.tokenVaultFactory = await TokenVaultFactory.deploy(this.singleCurveVaultImplementation.address, reserveRatio, fee, rejectionPremium );
        await this.tokenVaultFactory.deployed();

        this.nft.approve(this.tokenVaultFactory.address, 0);

        await this.tokenVaultFactory.createSingleCurveVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply,{ value: initialReserveBalance });
        const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
        this.tokenVault = new ethers.Contract(proxyAddress.toString(), SingleCurveNibblVault.interface, this.curator);
    })
    

    it("should initialize the vault with correct initial values.", async function () {
        expect(await this.tokenVault.name()).to.equal(tokenName);
        expect(await this.tokenVault.symbol()).to.equal(tokenSymbol);
        expect(await this.tokenVault.curator()).to.equal(this.curator.address);
        expect(await this.tokenVault.reserveTokenBalance()).to.equal(initialReserveBalance);
        expect(await this.tokenVault.status()).to.equal(1);
        expect(await this.tokenVault.fictitiousReserveBalance()).to.equal(reserveRatio.mul(initialTokenPrice).mul(initialTokenSupply));
        const unlockedTokens = initialTokenSupply.mul((ONE.sub(ONE.sub(initialReserveBalance.div(initialReserveBalance))).pow(reserveRatio) ));
        expect(await this.tokenVault.assetAddress()).to.equal(this.nft.address);
        expect(await this.tokenVault.assetTokenID()).to.equal(0);
        expect(await this.tokenVault.reservedTokenSupply()).to.equal(initialTokenSupply.sub(unlockedTokens));
        expect(await this.nft.ownerOf(0)).to.equal(this.tokenVault.address);
    })

    ///TODO: As the reserveRatio of lower selling curve is dynamic and the precision is not equal to 18 is there a chance of funds being stuck? Consider the case when someone sells all the supply.

})