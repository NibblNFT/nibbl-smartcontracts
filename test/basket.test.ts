import { expect } from 'chai';
import { ethers, network } from 'hardhat';
import { BigNumber, Contract, Signer } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO, ZERO, latest, advanceTimeAndBlock, duration, ADDRESS_ZERO, E18 } from "./helper";
import * as constants from "./constants";
import { TWAV } from './helper/twav';


describe("Basket", function () {
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
    let erc20: Contract;
    let erc1155: Contract;
    let basket: Contract;
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
    let basketAddress: string;

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
        basketAddress = await buyer2.getAddress();


        const Erc721 = await ethers.getContractFactory("ERC721Token");
        erc721 = await Erc721.deploy();
        await erc721.deployed(); 
        
        const Erc20 = await ethers.getContractFactory("ERC20Token");
        erc20 = await Erc20.deploy();
        await erc20.deployed(); 
        
        const Erc1155 = await ethers.getContractFactory("ERC1155Token");
        erc1155 = await Erc1155.deploy();
        await erc1155.deployed(); 
        

        const NibblVault = await ethers.getContractFactory("NibblVault");
        vaultImplementationContract = await NibblVault.deploy();
        await vaultImplementationContract.deployed();

        const Basket = await ethers.getContractFactory("Basket");
        const basketImplementationContract = await Basket.deploy();
        await basketImplementationContract.deployed();

        const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
        vaultFactoryContract = await NibblVaultFactory.connect(admin).deploy(vaultImplementationContract.address,
                                                                                    adminAddress,
                                                                                    adminAddress,
                                                                                    basketImplementationContract.address); 

        await vaultFactoryContract.deployed();

        await (await vaultFactoryContract.createBasket(curatorAddress, "Mix")).wait();
        basketAddress = await vaultFactoryContract.getBasketAddress(curatorAddress, "Mix");        
        await (await erc721.mint(basketAddress, 0)).wait();
        await (await erc721.mint(basketAddress, 1)).wait();
        await (await erc20.mint(basketAddress, ethers.utils.parseEther("1000"))).wait();
        await (await erc1155.mint(basketAddress, 0, ethers.utils.parseEther("1000"))).wait();
        basket = new ethers.Contract(basketAddress, Basket.interface, curator);

    });
    
    beforeEach(async function () {
        twav = new TWAV();
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("should setup", async function () {
        expect(await erc721.ownerOf(0)).to.equal(basketAddress)
        expect(await erc721.ownerOf(1)).to.equal(basketAddress)
        expect(await basket.name()).to.equal("NibblBasket")
        expect(await basket.symbol()).to.equal("NB")
        expect(await erc20.balanceOf(basketAddress)).to.equal(ethers.utils.parseEther("1000"))
        expect(await erc1155.balanceOf(basketAddress, 0)).to.equal(ethers.utils.parseEther("1000"))

    });

    it("should allow owner to withdraw ERC721", async function () {
        await (await basket.withdrawERC721(erc721.address, 0, curatorAddress)).wait();
        expect(await erc721.ownerOf(0)).to.equal(curatorAddress)
    });

    it("should not allow not-owner to withdraw ERC721", async function () {
        await (expect(basket.connect(admin).withdrawERC721(erc721.address, 0, curatorAddress)).to.be.reverted)
    });

    it("should allow owner to withdraw ERC20", async function () {
        await (await basket.withdrawERC20(erc20.address, curatorAddress)).wait();
        expect(await erc20.balanceOf(curatorAddress)).to.equal(ethers.utils.parseEther("1000"))
    });

    it("should allow owner to withdraw ERC1155", async function () {
        await (await basket.withdrawERC1155(erc1155.address, 0, curatorAddress)).wait();
        expect(await erc1155.balanceOf(curatorAddress, 0)).to.equal(ethers.utils.parseEther("1000"))
    });

});