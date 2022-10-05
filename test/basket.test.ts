import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Basket, Basket__factory, ERC1155TestToken, ERC1155TestToken__factory, ERC20TestToken, ERC20TestToken__factory, ERC721TestToken, ERC721TestToken__factory, NibblVault, NibblVaultFactory, NibblVaultFactory__factory, NibblVault__factory } from "../typechain-types";

describe("Basket", function () {

  async function deployBasketFixture() {
    const [admin, curator, feeTo, user1, user2] = await ethers.getSigners();
    // Deploy ERC721Token
    const ERC721Token_Factory: ERC721TestToken__factory = await ethers.getContractFactory("ERC721TestToken");
    const erc721Token: ERC721TestToken = await (await ERC721Token_Factory.deploy()).deployed();

    const ERC20Token_Factory: ERC20TestToken__factory = await ethers.getContractFactory("ERC20TestToken");
    const erc20Token: ERC20TestToken = await (await ERC20Token_Factory.deploy()).deployed();
      
    const ERC1155Token_Factory: ERC1155TestToken__factory = await ethers.getContractFactory("ERC1155TestToken");
    const erc1155Token: ERC1155TestToken = await (await ERC1155Token_Factory.deploy()).deployed();
        
    //Deploy NibblVaultImplementation
    const NibblVault_Factory: NibblVault__factory = await ethers.getContractFactory("NibblVault");
    const vaultImplementation: NibblVault = await (await NibblVault_Factory.deploy()).deployed();
    
    // Deploy BasketImplementation
    const Basket_Factory: Basket__factory = await ethers.getContractFactory("Basket");
    const basketImplementation: Basket = await (await Basket_Factory.deploy()).deployed();
    
    // Deploy NibblVaultFactory
    const NibblVaultFactory: NibblVaultFactory__factory = await ethers.getContractFactory("NibblVaultFactory");
    const vaultFactoryContract = await (await NibblVaultFactory.connect(admin).deploy(vaultImplementation.address, feeTo.address, admin.address, basketImplementation.address)).deployed();
    
    await vaultFactoryContract.createBasket(curator.address, "Mix")  
    const _basketAddress = await vaultFactoryContract.getBasketAddress(curator.address, "Mix");

    const basket = Basket_Factory.attach(_basketAddress);
    await erc721Token.mint(basket.address, 0);
    await erc721Token.mint(basket.address, 1);
    
    await erc1155Token.mint(basket.address, 0, 500)
    await erc1155Token.mint(basket.address, 1, 500)
      
    await erc20Token.mint(basket.address, 1000);
    
    return { admin, feeTo, user1, user2, erc721Token, erc20Token, erc1155Token, vaultFactoryContract, curator, basket };
  }

  
  describe("Basket Creation and Initialization", function () {

    it("should setup", async function () {
        const { curator, erc721Token, erc20Token, erc1155Token, basket } = await loadFixture(deployBasketFixture);
        expect(await basket.name()).to.equal("NibblBasket")
        expect(await basket.symbol()).to.equal("NB")
        expect(await basket.ownerOf(0)).to.equal(curator.address)
        expect(await erc721Token.ownerOf(0)).to.equal(basket.address)
        expect(await erc721Token.ownerOf(1)).to.equal(basket.address)
        expect(await erc20Token.balanceOf(basket.address)).to.equal("1000")
        expect(await erc1155Token.balanceOf(basket.address, 0)).to.equal("500")
        expect(await erc1155Token.balanceOf(basket.address, 1)).to.equal("500")
    });
    
  });

  describe("Withdrawals from basket", function () {

    it("should allow withdraw erc20", async function () {
        const { user1, erc20Token, basket, curator } = await loadFixture(deployBasketFixture);
        await basket.connect(curator).withdrawERC20(erc20Token.address, user1.address)
        expect(await erc20Token.balanceOf(user1.address)).to.equal("1000")
    });

    it("should allow withdraw erc721", async function () {
        const { user1, erc721Token, basket, curator } = await loadFixture(deployBasketFixture);
        await basket.connect(curator).withdrawERC721(erc721Token.address, 0, user1.address)
        expect(await erc721Token.ownerOf(0)).to.equal(user1.address)
    });

    it("should allow withdraw erc1155", async function () {
        const { user1, erc1155Token, basket, curator } = await loadFixture(deployBasketFixture);
        await basket.connect(curator).withdrawERC1155(erc1155Token.address, 0, user1.address)
        expect(await erc1155Token.balanceOf(user1.address, 0)).to.equal(500)
    });

    it("should only allow owner of tokenID 0 to withdraw erc20", async function () {
        const { user1, erc20Token, basket } = await loadFixture(deployBasketFixture);
        await expect(basket.connect(user1).withdrawERC20(erc20Token.address, user1.address)).to.be.revertedWith("withdraw:not allowed")
    });

    it("should only allow owner of tokenID 0 to withdraw erc721", async function () {
        const { user1, erc721Token, basket } = await loadFixture(deployBasketFixture);
        await expect(basket.connect(user1).withdrawERC721(erc721Token.address, 0, user1.address)).to.be.revertedWith("withdraw:not allowed")
    });
    
    it("should only allow owner of tokenID 0 to withdraw erc1155", async function () {
        const { user1, erc1155Token, basket } = await loadFixture(deployBasketFixture);
        await expect(basket.connect(user1).withdrawERC1155(erc1155Token.address, 0, user1.address)).to.be.revertedWith("withdraw:not allowed")
    });
    
  });


});
