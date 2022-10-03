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
    
    // Deploy BasketImplementation
    const ERC1155Link_Factory: ERC1155Link__factory = await ethers.getContractFactory("ERC1155Link");
    const erc1155LinkImplementation: ERC1155Link = await (await ERC1155Link_Factory.deploy()).deployed();
        
    //Deploy NibblVaultImplementation
    const NibblVault_Factory: NibblVault__factory = await ethers.getContractFactory("NibblVault");
    const vaultImplementation: NibblVault = await (await NibblVault_Factory.deploy()).deployed();
      
    //Deploy NibblVaultImplementation
    const NibblVault2_Factory: NibblVault2__factory = await ethers.getContractFactory("NibblVault2");
    const vaultImplementation2: NibblVault2 = await (await NibblVault2_Factory.deploy(erc1155LinkImplementation.address)).deployed();
    
      
    // Deploy BasketImplementation
    const Basket_Factory: Basket__factory = await ethers.getContractFactory("Basket");
    const basketImplementation: Basket = await (await Basket_Factory.deploy()).deployed();
    
    // Deploy NibblVaultFactory
    const NibblVaultFactory: NibblVaultFactory__factory = await ethers.getContractFactory("NibblVaultFactory");
    const vaultFactoryContract: NibblVaultFactory = await (await NibblVaultFactory.connect(admin).deploy(vaultImplementation.address, feeTo.address, admin.address, basketImplementation.address)).deployed();
    
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
    
    await vaultFactoryContract.updateVaultImplementation();
      
    const proxyAddress = await vaultFactoryContract.getVaultAddress(curator.address, erc721Token.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);
    const vaultContract: NibblVault2 = NibblVault2_Factory.attach(proxyAddress).connect(curator)

    return { admin, implementationRole, feeRole, pausingRole, feeTo, user1, user2, erc721Token, vaultFactoryContract, vaultContract, curator, testBancorFormulaContract, buyer1};
  }

    it("Should deploy erc1155 link", async function () {
        const { vaultContract, curator } = await loadFixture(deployNibblVaultFixture);
        await vaultContract.connect(curator).setURL("K");
        expect(await vaultContract.imageUrl()).to.be.equal("K");
        
        await vaultContract.createERC1155Link(100);
        expect(await vaultContract.nibblERC1155Link()).to.be.not.null;        
        const erc1155LinkAddr = await vaultContract.nibblERC1155Link();
        const ERC1155Link = await ethers.getContractFactory("ERC1155Link");        
        const erc1155Link = ERC1155Link.attach(erc1155LinkAddr);
        expect(await erc1155Link.linkErc20()).to.be.equal(vaultContract.address)
    })
    
    it("Only curator should deploy erc1155 link", async function () {
        const { vaultContract, curator, user1 } = await loadFixture(deployNibblVaultFixture);
        await vaultContract.connect(curator).setURL("K");
        expect(await vaultContract.imageUrl()).to.be.equal("K");
        
        expect(vaultContract.connect(user1).createERC1155Link(100)).to.be.revertedWith("NibblVault: !Curator");        
    })
    
    it("Should not deploy erc1155 link if !URL", async function () {
        const { vaultContract } = await loadFixture(deployNibblVaultFixture);
        await expect(vaultContract.createERC1155Link(100)).to.be.revertedWith("NibblVault: !URL");        
    })
    
    it("Should not deploy erc1155 link if invalid ratio", async function () {
        const { vaultContract, curator } = await loadFixture(deployNibblVaultFixture);
        await vaultContract.connect(curator).setURL("K");
        expect(await vaultContract.imageUrl()).to.be.equal("K");
        await expect(vaultContract.createERC1155Link(0)).to.be.revertedWith("NibblVault: Invalid Ratio");
    });
    
    it("Should wrap fractionalised tokens to ERC1155s", async function () {
        const { vaultContract, curator } = await loadFixture(deployNibblVaultFixture);
        await vaultContract.connect(curator).setURL("K");
        expect(await vaultContract.imageUrl()).to.be.equal("K");
        await vaultContract.createERC1155Link(100);
        expect(await vaultContract.nibblERC1155Link()).to.be.not.null;    
        const erc1155LinkAddr = await vaultContract.nibblERC1155Link();
        const ERC1155Link = await ethers.getContractFactory("ERC1155Link");        
        const erc1155Link = ERC1155Link.attach(erc1155LinkAddr);
        await vaultContract.connect(curator).approve(erc1155LinkAddr, 10000);
        const _userFractionBalInitial = await vaultContract.balanceOf(curator.address);
        await erc1155Link.connect(curator).wrap(await curator.getAddress(), 100);
        expect(await vaultContract.balanceOf(erc1155LinkAddr)).to.be.equal(10000);
        expect(_userFractionBalInitial.sub(await vaultContract.balanceOf(curator.address))).to.be.equal(10000);
        expect(await erc1155Link.balanceOf(curator.address, 0)).to.be.equal(100);
    });
    
    it("Should unwrap ERC1155s fractionalised tokens", async function () {
        const { vaultContract, curator } = await loadFixture(deployNibblVaultFixture);
        await vaultContract.connect(curator).setURL("K");
        await vaultContract.createERC1155Link(100);
        const erc1155LinkAddr = await vaultContract.nibblERC1155Link();
        const ERC1155Link = await ethers.getContractFactory("ERC1155Link");        
        const erc1155Link = ERC1155Link.attach(erc1155LinkAddr);
        await vaultContract.connect(curator).approve(erc1155LinkAddr, 10000);
        const _userFractionBalInitial = await vaultContract.balanceOf(curator.address);
        await erc1155Link.connect(curator).wrap(await curator.getAddress(), 100);
        expect(await vaultContract.balanceOf(erc1155LinkAddr)).to.be.equal(10000);
        expect(_userFractionBalInitial.sub(await vaultContract.balanceOf(curator.address))).to.be.equal(10000);
        expect(await erc1155Link.balanceOf(curator.address, 0)).to.be.equal(100);
        // Wrapped
        
        await erc1155Link.connect(curator).unwrap(await curator.getAddress(), 50);
        expect(await vaultContract.balanceOf(erc1155LinkAddr)).to.be.equal(5000);
        expect(_userFractionBalInitial.sub(await vaultContract.balanceOf(curator.address))).to.be.equal(5000);
        expect(await erc1155Link.balanceOf(curator.address, 0)).to.be.equal(50);
    });
  
});
