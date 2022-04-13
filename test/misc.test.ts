import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { BigNumber, Contract, Signer } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO, ONE, latest } from "./helper";
import * as constants from "./constants";


describe("NibblTokenVault: Misc ", function () {
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
            curatorAddress,
            constants.tokenName,
            constants.tokenSymbol,
            0,
            constants.initialTokenSupply,
            constants.initialTokenPrice,
            await latest(),
            { value: constants.initialSecondaryReserveBalance });

        const proxyAddress = await vaultFactoryContract.getVaultAddress(curatorAddress, erc721.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, buyer1);

    });
    
    beforeEach(async function () {
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("should fail to transfer eth", async function () {
        const Reenterer = await ethers.getContractFactory("Reenterer");
        const reenterer = await Reenterer.deploy();
        await reenterer.deployed()
        const _sellAmount = (constants.initialTokenSupply).div(5);
        let _balanceAddr1 = await addr1.provider.getBalance(await addr1.getAddress());
        const _expectedSaleReturn = await burnTokens(testBancorFormula, constants.initialTokenSupply, constants.initialSecondaryReserveBalance, constants.initialSecondaryReserveRatio, _sellAmount);        
        await expect(vaultContract.connect(curator).sell(_sellAmount, _expectedSaleReturn, reenterer.address)).to.be.revertedWith("NibblVault: ETH transfer failed");
    })

    it("should fail to reenter", async function () {
        const MaliciousNibblVaultFactory = await ethers.getContractFactory("MaliciousNibblVaultFactory");
        const maliciousNibblVaultFactory = await MaliciousNibblVaultFactory.connect(admin).deploy(vaultImplementationContract.address,
                                                                                    await admin.getAddress(),
                                                                                    await admin.getAddress()); 
        await maliciousNibblVaultFactory.deployed();
        await erc721.mint(await curator.getAddress(), 1);
        await erc721.connect(curator).approve(maliciousNibblVaultFactory.address, 1);
            
        await maliciousNibblVaultFactory.connect(curator).createVault(erc721.address,
            curatorAddress,
            constants.tokenName,
            constants.tokenSymbol,
            1,
            constants.initialTokenSupply,
            constants.initialTokenPrice,
            await latest(),
            { value: constants.initialSecondaryReserveBalance });

        const NibblVault = await ethers.getContractFactory("NibblVault");

        const proxyAddress = await maliciousNibblVaultFactory.getVaultAddress(curatorAddress, erc721.address, 1, constants.initialTokenSupply, constants.initialTokenPrice);
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, buyer1);

        await expect(vaultContract.connect(curator).buy(0, maliciousNibblVaultFactory.address, { value: getBigNumber("10000")})).to.be.revertedWith("NibblVault: ETH transfer failed");
    })

});