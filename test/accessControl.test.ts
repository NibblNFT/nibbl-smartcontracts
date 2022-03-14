import { expect } from 'chai';
import { ethers } from 'hardhat';
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
                                            0,
                                            constants.tokenName,
                                            constants.tokenSymbol,
                                            constants.initialTokenSupply,
                                            constants.initialTokenPrice,
                                            { value: constants.initialSecondaryReserveBalance });

        const proxyAddress = await vaultFactoryContract.getVaultAddress(curatorAddress, erc721.address, 0, constants.tokenName, constants.tokenSymbol);
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, curator);
        
    });
    
    beforeEach(async function () {
        twav = new TWAV();
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("Should propose a role to user", async function () {
        await vaultFactoryContract.connect(admin).proposeGrantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), await implementorRole.getAddress());
        expect(await vaultFactoryContract.pendingRoles(await vaultFactoryContract.IMPLEMENTER_ROLE(), await implementorRole.getAddress())).to.be.true;
    });

    it("Should propose a role to user and claim role", async function () {
        await vaultFactoryContract.connect(admin).proposeGrantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), await implementorRole.getAddress());
        expect(await vaultFactoryContract.pendingRoles(await vaultFactoryContract.IMPLEMENTER_ROLE(), await implementorRole.getAddress())).to.be.true;
        await vaultFactoryContract.connect(implementorRole).claimRole(await vaultFactoryContract.IMPLEMENTER_ROLE());
        expect(await vaultFactoryContract.hasRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), await implementorRole.getAddress())).to.be.true;
        
    });
});