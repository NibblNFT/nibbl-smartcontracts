import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, Signer } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO } from "./helper";
import * as constants from "./constants";


describe("NibblTokenVault: Initialisation ", function () {
    let accounts: Signer[];
    let snapshotId: Number;
    let curator: Signer;
    let buyer1: Signer;
    let admin: Signer;
    let addr1: Signer;
    let erc721: Contract;
    let vaultContract: Contract;
    let vaultImplementationContract: Contract;
    let vaultFactoryContract: Contract;
    let testBancorFormula: Contract;
    let pauserRole: Signer;

    let adminAddress: string;
    let implementorRoleAddress: string;
    let pauserRoleAddress: string;
    let feeRoleAddress: string;
    let curatorAddress: string;
    let addr1Address: string;
    let buyer1Address: string;

    before(async function () {
        accounts = await ethers.getSigners();   
        curator = accounts[0];
        buyer1 = accounts[1];
        admin = accounts[2];
        addr1 = accounts[3];
        pauserRole = accounts[4];


        adminAddress = await admin.getAddress();
        pauserRoleAddress = await pauserRole.getAddress();
        curatorAddress = await curator.getAddress();
        buyer1Address = await buyer1.getAddress();
        addr1Address = await addr1.getAddress();

        const Erc721 = await ethers.getContractFactory("ERC721Token");
        erc721 = await Erc721.deploy();
        await erc721.deployed(); 
        await erc721.mint(await curator.getAddress(), 0);
        const NibblVault = await ethers.getContractFactory("NibblVault");
        vaultImplementationContract = await NibblVault.deploy();
        await vaultImplementationContract.deployed();
        const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
        vaultFactoryContract = await NibblVaultFactory.connect(admin).deploy(vaultImplementationContract.address,
                                                                                    await admin.getAddress(),
                                                                                    await admin.getAddress()); 
        await vaultFactoryContract.deployed();
        await erc721.approve(vaultFactoryContract.address, 0);
        const TestBancorBondingCurve = await ethers.getContractFactory("TestBancorFormula");
        testBancorFormula = await TestBancorBondingCurve.deploy();
        await testBancorFormula.deployed();
        await vaultFactoryContract.connect(curator).createVault(erc721.address,
                                                0,
                                                constants.tokenName,
                                                constants.tokenSymbol,
                                                constants.initialTokenSupply,
                                                constants.initialTokenPrice,
                                                { value: constants.initialSecondaryReserveBalance });

        const proxyAddress = await vaultFactoryContract.getVaultAddress(curatorAddress, erc721.address, 0, constants.tokenName, constants.tokenSymbol, constants.initialTokenSupply);
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, buyer1);

    });
    
    beforeEach(async function () {
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("should initialize the vault.", async function () {
        expect(await vaultContract.name()).to.equal(constants.tokenName);
        expect(await vaultContract.symbol()).to.equal(constants.tokenSymbol);
        expect(await vaultContract.curator()).to.equal(await curator.getAddress());
        expect(await vaultContract.status()).to.equal(0);        
        expect(await vaultContract.assetAddress()).to.equal(erc721.address);
        expect(await vaultContract.assetID()).to.equal(0);
        expect(await vaultContract.initialTokenSupply()).to.equal(constants.initialTokenSupply);
        expect(await vaultContract.secondaryReserveBalance()).to.equal(constants.initialSecondaryReserveBalance);
        expect(await vaultContract.secondaryReserveRatio()).to.equal(constants.initialSecondaryReserveRatio);
        expect(await vaultContract.primaryReserveBalance()).to.equal(constants.initialPrimaryReserveBalance);
        expect(await vaultContract.curatorFee()).to.equal(constants.FEE_CURATOR);
    });


    it("should not initialize the vault if secondaryReserveRatio > primaryReserveRatio.", async function () {
        await erc721.mint(await curator.getAddress(), 1);
        await erc721.approve(vaultFactoryContract.address, 1);

        

        await expect(vaultFactoryContract.connect(curator).createVault(erc721.address,
                                                1,
                                                constants.tokenName,
                                                constants.tokenSymbol,
                                                constants.initialTokenSupply,
                                                constants.initialTokenPrice,
                                                { value: (constants.primaryReserveRatio.mul(constants.initialValuation).div(constants.SCALE)).add(getBigNumber(1)) })).to.be.revertedWith("NibblVault: Excess initial funds");
    });

    it("should not initialize the vault if secondaryReserveRatio too low.", async function () {
        await erc721.mint(await curator.getAddress(), 1);
        await erc721.approve(vaultFactoryContract.address, 1);

        await expect(vaultFactoryContract.connect(curator).createVault(erc721.address,
                                                1,
                                                constants.tokenName,
                                                constants.tokenSymbol,
                                                constants.initialTokenSupply,
                                                constants.initialTokenPrice,
                                                { value: (constants.initialSecondaryReserveBalance.div(getBigNumber(3, 3))) })).to.be.revertedWith("NibblVault: secResRatio too low");
    });


});