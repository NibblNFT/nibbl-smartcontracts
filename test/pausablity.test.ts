import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, Signer } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO, ZERO, latest } from "./helper";
import * as constants from "./constants";


describe("Pausablity", function () {
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
    
    before(async function () {
        accounts = await ethers.getSigners();   
        admin = accounts[0];
        implementorRole = accounts[1];
        pauserRole = accounts[2];
        feeRole = accounts[3];
        curator = accounts[4];
        buyer1 = accounts[5];
        buyer2 = accounts[6];

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

        const proxyAddress = await vaultFactoryContract.getVaultAddress(await curator.getAddress(), erc721.address, 0, constants.tokenName, constants.tokenSymbol, constants.initialTokenSupply);
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, curator);

    });
    
    beforeEach(async function () {
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("should be able to pause", async function () {
        await vaultFactoryContract.connect(pauserRole).pause();
        expect(await vaultFactoryContract.paused()).to.be.equal(true);
    });

    it("should be able to unpause", async function () {
      await vaultFactoryContract.connect(pauserRole).pause();
      expect(await vaultFactoryContract.paused()).to.be.equal(true);
      await vaultFactoryContract.connect(pauserRole).unPause();
      expect(await vaultFactoryContract.paused()).to.be.equal(false);
    });

    it("should not allow buy/sell when paused", async function () {
        await vaultFactoryContract.connect(pauserRole).pause();
        expect(await vaultFactoryContract.paused()).to.be.equal(true);
        const _buyAmount = ethers.utils.parseEther("1");

        await expect(vaultContract.connect(buyer1).buy(0, await buyer1.getAddress(), { value: _buyAmount })).to.be.revertedWith("NibblVault: Paused");
        await expect(vaultContract.connect(curator).sell(100, 0, await buyer1.getAddress())).to.be.revertedWith("NibblVault: Paused");
    });


});