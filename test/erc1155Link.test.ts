import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber } from "ethers";
import { ethers, network } from "hardhat";
import { Basket, Basket__factory, ERC1155Link, ERC1155Link__factory, ERC721TestToken, ERC721TestToken__factory, NibblVault, NibblVault2, NibblVault2__factory, NibblVaultFactory, NibblVaultFactory__factory, NibblVault__factory, TestBancorFormula, TestBancorFormula__factory } from "../typechain-types";
import * as constants from "./constants";
import { getBigNumber, getCurrentValuation } from "./helper";
import { TWAV } from "./twav";

describe("ERC1155 Wrap", function () {

  async function deployNibblVaultFixture() {
    const [admin, implementationRole, feeRole, pausingRole, curator, feeTo, user1, user2, buyer1] = await ethers.getSigners();
    // Deploy ERC721Token
    const ERC721Token_Factory: ERC721TestToken__factory = await ethers.getContractFactory("ERC721TestToken");
    const erc721Token: ERC721TestToken = await (await ERC721Token_Factory.deploy()).deployed();
    
    //Deploy NibblVaultImplementation
    const NibblVault_Factory: NibblVault__factory = await ethers.getContractFactory("NibblVault");
    const vaultImplementation: NibblVault = await (await NibblVault_Factory.deploy()).deployed();
    
    // Deploy BasketImplementation
    const Basket_Factory: Basket__factory = await ethers.getContractFactory("Basket");
    const basketImplementation: Basket = await (await Basket_Factory.deploy()).deployed();
    
    // Deploy NibblVaultFactory
    const NibblVaultFactory: NibblVaultFactory__factory = await ethers.getContractFactory("NibblVaultFactory");
    const vaultFactoryContract: NibblVaultFactory = await (await NibblVaultFactory.connect(admin).deploy(vaultImplementation.address, feeTo.address, admin.address, basketImplementation.address)).deployed();
    
    const ERC1155Link_Factory: ERC1155Link__factory = await ethers.getContractFactory("ERC1155Link");
    const erc1155LinkImplementation: ERC1155Link = await (await ERC1155Link_Factory.deploy(vaultFactoryContract.address)).deployed();
    
    //Deploy NibblVaultImplementation
    const NibblVault2_Factory: NibblVault2__factory = await ethers.getContractFactory("NibblVault2");
    const vaultImplementation2: NibblVault2 = await (await NibblVault2_Factory.deploy(erc1155LinkImplementation.address)).deployed();
    
    const TestBancorFormula: TestBancorFormula__factory = await ethers.getContractFactory("TestBancorFormula");
    const testBancorFormulaContract: TestBancorFormula = await (await TestBancorFormula.connect(admin).deploy()).deployed();
    
    // grant roles
    await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.FEE_ROLE(), feeRole.address);
    await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.PAUSER_ROLE(), pausingRole.address);
    await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), implementationRole.address);
    
    await erc721Token.mint(curator.address, 0);
    await erc721Token.connect(curator).approve(vaultFactoryContract.address, 0);

    //create a vault
    await vaultFactoryContract.connect(curator).createVault( erc721Token.address, curator.address, constants.tokenName, constants.tokenSymbol, 0, constants.initialTokenSupply, constants.initialTokenPrice, (await time.latest()) + time.duration.days(4), { value: constants.initialSecondaryReserveBalance });

    await vaultFactoryContract.connect(implementationRole).proposeNewVaultImplementation(vaultImplementation2.address);
    await time.increase(constants.UPDATE_TIME_FACTORY);
    const proxyAddress = await vaultFactoryContract.getVaultAddress(curator.address, erc721Token.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);
    const vaultContract: NibblVault2 = NibblVault2_Factory.attach(proxyAddress).connect(curator)
    
    await vaultFactoryContract.updateVaultImplementation();
    
    
    await (await vaultContract.createERC1155Link("Name", "Symbol")).wait();
    const erc1155Link = ERC1155Link_Factory.attach(await vaultContract.nibblERC1155Link());
      
    return { admin, implementationRole, feeRole, pausingRole, feeTo, user1, user2, erc721Token, vaultFactoryContract, vaultContract, curator, testBancorFormulaContract, buyer1, erc1155Link};
  }

    describe("Wrapping and UnWrapping", () => {
        
    it("Should add tier", async function () {
        const { vaultContract, curator, erc1155Link } = await loadFixture(deployNibblVaultFixture);
        const _tokenID = 0
      
        await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
      
        expect(await erc1155Link.uri(_tokenID)).to.be.equal(constants.URI);
        expect(await erc1155Link.mintRatio(_tokenID)).to.be.equal(constants.MINT_RATIO);
        expect(await erc1155Link.userCap(_tokenID)).to.be.equal(constants.USER_CAP);
        expect(await erc1155Link.userMint(_tokenID, curator.address)).to.be.equal(0);
        expect(await erc1155Link.maxCap(_tokenID)).to.be.equal(constants.MAX_CAP);
        expect(await erc1155Link.totalSupply(_tokenID)).to.be.equal(0);
    });

    // it("Should not add tier if sender isn't curator", async function () {
    //     const { user1, erc1155Link } = await loadFixture(deployNibblVaultFixture);
    //     const _tokenID = 0
    //     await expect(erc1155Link.connect(user1).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).to.be.revertedWith("ERC1155Link: Only Curator")
    // });

    // it("Should not add tier if mintRatio = 0", async function () {
    //     const { curator, erc1155Link } = await loadFixture(deployNibblVaultFixture);
    //     const _tokenID = 0
    //     await expect(erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, 0, _tokenID, constants.URI)).to.be.revertedWith("ERC1155Link: !Ratio")
    // });

    // it("Should not add tier if tier already exists", async function () {
    //     const { curator, erc1155Link } = await loadFixture(deployNibblVaultFixture);
    //     const _tokenID = 0
    //     await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
    //     await expect(erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).to.be.revertedWith("ERC1155Link: Tier Exists")
    // });

    // it("Should wrap tokens", async function () {
    //     const { curator, erc1155Link, vaultContract, user1 } = await loadFixture(deployNibblVaultFixture);
    //     const _tokenID = 0
    //     await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
    //     //Huge Buy
    //     await (await vaultContract.connect(user1).buy(0, user1.address, { value: ethers.utils.parseEther("100") })).wait();
    //     await (await vaultContract.connect(user1).approve(erc1155Link.address, await vaultContract.balanceOf(user1.address))).wait()        
    //     const balanceUser1Initial = await vaultContract.balanceOf(user1.address);
    //     const wrapAmt = 10;
    //     await (await erc1155Link.connect(user1).wrap(wrapAmt, 0, user1.address)).wait()
    //     expect(await vaultContract.balanceOf(user1.address)).to.be.equal(balanceUser1Initial.sub(constants.MINT_RATIO.mul(wrapAmt)));
    //     expect(await erc1155Link.balanceOf(user1.address, _tokenID)).to.be.equal(wrapAmt)
    // });

    // it("Should not wrap tokens if user cap reached", async function () {
    //     const { curator, erc1155Link, vaultContract, user1 } = await loadFixture(deployNibblVaultFixture);
    //     const _tokenID = 0
    //     await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
    //     //Huge Buy
    //     await (await vaultContract.connect(user1).buy(0, user1.address, { value: ethers.utils.parseEther("100") })).wait();
    //     await (await vaultContract.connect(user1).approve(erc1155Link.address, await vaultContract.balanceOf(user1.address))).wait()        
    //     const wrapAmt = 100;
    //     await (await erc1155Link.connect(user1).wrap(wrapAmt, 0, user1.address)).wait()
    //     await expect(erc1155Link.connect(user1).wrap(wrapAmt, 0, user1.address)).to.be.rejectedWith("ERC1155Link: !UserCap")
    // });
    
    // it("Should not wrap tokens if max cap reached", async function () {
    //     const { curator, erc1155Link, vaultContract, user1, user2, buyer1 } = await loadFixture(deployNibblVaultFixture);
    //     const _tokenID = 0
    //     await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
    //     //Huge Buy
    //     await (await vaultContract.connect(user1).buy(0, user1.address, { value: ethers.utils.parseEther("100") })).wait();
    //     await (await vaultContract.connect(user2).buy(0, user2.address, { value: ethers.utils.parseEther("200") })).wait();
    //     await (await vaultContract.connect(buyer1).buy(0, buyer1.address, { value: ethers.utils.parseEther("300") })).wait();

    //     await (await vaultContract.connect(user1).approve(erc1155Link.address, await vaultContract.balanceOf(user1.address))).wait()        
    //     await (await vaultContract.connect(user2).approve(erc1155Link.address, await vaultContract.balanceOf(user2.address))).wait()        
    //     await (await vaultContract.connect(buyer1).approve(erc1155Link.address, await vaultContract.balanceOf(buyer1.address))).wait()        
    //     const wrapAmt = 100;
    //     await (await erc1155Link.connect(user1).wrap(wrapAmt, 0, user1.address)).wait()
    //     await (await erc1155Link.connect(user2).wrap(wrapAmt, 0, user1.address)).wait()
    //     await expect(erc1155Link.connect(buyer1).wrap(wrapAmt, 0, user1.address)).to.be.revertedWith("ERC1155Link: !MaxCap")
    // });
    
    // it("Should not wrap tokens if tier not active", async function () {
    //     const { curator, erc1155Link, vaultContract, user1 } = await loadFixture(deployNibblVaultFixture);
    //     expect(erc1155Link.connect(user1).wrap(10, 0, user1.address)).to.be.revertedWith("ERC1155Link: !TokenID")
    // });
    
    // it("Should unwrap tokens", async function () {
    //     const { curator, erc1155Link, vaultContract, user1 } = await loadFixture(deployNibblVaultFixture);
    //     const _tokenID = 0
    //     await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
    //     await (await vaultContract.connect(user1).buy(0, user1.address, { value: ethers.utils.parseEther("100") })).wait();
    //     await (await vaultContract.connect(user1).approve(erc1155Link.address, await vaultContract.balanceOf(user1.address))).wait()        
    //     const wrapAmt = 10;
    //     await (await erc1155Link.connect(user1).wrap(wrapAmt, 0, user1.address)).wait()
    //     const balanceUser1Initial = await vaultContract.balanceOf(user1.address);
    //     const unWrapAmt = 5;
    //     await (await erc1155Link.connect(user1).unwrap(unWrapAmt, 0, user1.address)).wait()
    //     expect(await vaultContract.balanceOf(user1.address)).to.be.equal(balanceUser1Initial.add(constants.MINT_RATIO.mul(unWrapAmt)));
    //     expect(await erc1155Link.balanceOf(user1.address, _tokenID)).to.be.equal(wrapAmt - unWrapAmt)
        
    // });
    // })

    // describe("Pausablity", () => { 
    // it("Should not wrap tokens when paused", async function () {
    //     const { curator, erc1155Link, vaultContract, user1, vaultFactoryContract, pausingRole } = await loadFixture(deployNibblVaultFixture);
    //     const _tokenID = 0
    //     await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
    //     await (await vaultContract.connect(user1).buy(0, user1.address, { value: ethers.utils.parseEther("100") })).wait();
    //     await (await vaultContract.connect(user1).approve(erc1155Link.address, await vaultContract.balanceOf(user1.address))).wait()        

    //     await (await vaultFactoryContract.connect(pausingRole).pause()).wait()

    //     const wrapAmt = 10;
    //     await expect(erc1155Link.connect(user1).wrap(wrapAmt, 0, user1.address)).to.be.revertedWith("ERC1155Link: Paused")

        
    // });
        
    // it("Should not wrap tokens when paused", async function () {
    //     const { curator, erc1155Link, vaultContract, user1, vaultFactoryContract, pausingRole } = await loadFixture(deployNibblVaultFixture);
    //     const _tokenID = 0
    //     await (await erc1155Link.connect(curator).addTier(constants.MAX_CAP, constants.USER_CAP, constants.MINT_RATIO, _tokenID, constants.URI)).wait();
    //     await (await vaultContract.connect(user1).buy(0, user1.address, { value: ethers.utils.parseEther("100") })).wait();
    //     await (await vaultContract.connect(user1).approve(erc1155Link.address, await vaultContract.balanceOf(user1.address))).wait()        
    //     const wrapAmt = 10;
    //     await (await erc1155Link.connect(user1).wrap(wrapAmt, 0, user1.address)).wait()
    //     await (await vaultFactoryContract.connect(pausingRole).pause()).wait()
    //     const unWrapAmt = 5;
    //     await expect(erc1155Link.connect(user1).unwrap(unWrapAmt, 0, user1.address)).to.be.revertedWith("ERC1155Link: Paused")
    // });
    })
  
});
