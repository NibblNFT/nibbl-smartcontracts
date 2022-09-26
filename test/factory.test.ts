import helpers, { time, loadFixture, mine } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers } from "hardhat";
import { Basket, Basket__factory, ERC721TestToken, ERC721TestToken__factory, NibblVault, NibblVaultFactory, NibblVaultFactory__factory, NibblVault__factory } from "../typechain-types";
import * as constants from "./constants";

describe("NibblVaultFactory", function () {

  async function deployNibblVaultFactoryFixture() {
    const [admin, implementationRole, feeRole, pausingRole, curator, feeTo, user1, user2] = await ethers.getSigners();
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
    const vaultFactoryContract = await (await NibblVaultFactory.connect(admin).deploy(vaultImplementation.address, feeTo.address, admin.address, basketImplementation.address)).deployed();
    
    // grant roles
    await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.FEE_ROLE(), feeRole.address);
    await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.PAUSER_ROLE(), pausingRole.address);
    await vaultFactoryContract.connect(admin).grantRole(await vaultFactoryContract.IMPLEMENTER_ROLE(), implementationRole.address);
    
    await erc721Token.mint(curator.address, 0);
    await erc721Token.connect(curator).approve(vaultFactoryContract.address, 0);

    //create a vault
    await vaultFactoryContract.connect(curator).createVault( erc721Token.address, curator.address, constants.tokenName, constants.tokenSymbol, 0, constants.initialTokenSupply, constants.initialTokenPrice, await time.latest(), { value: constants.initialSecondaryReserveBalance });

    const proxyAddress = await vaultFactoryContract.getVaultAddress(curator.address, erc721Token.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);
    const vaultContract: NibblVault = NibblVault_Factory.attach(proxyAddress)

    return { admin, implementationRole, feeRole, pausingRole, feeTo, user1, user2, erc721Token, vaultFactoryContract, vaultContract };
  }

  describe("Propose and Update params", function () {
    it("Should propose feeTo address", async function () {
      const { feeRole, user1, vaultFactoryContract } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(feeRole).proposeNewAdminFeeAddress(user1.address);
      const blockTime: number = await time.latest(); // Record blockTime after proposing new admin fee address
      const expectedFeeToUpdateTime = blockTime + constants.UPDATE_TIME_FACTORY; // expectedFeeToUpdateTime is latest + UPDATE_TIME_FACTORY
      expect(await vaultFactoryContract.pendingFeeTo()).to.be.equal(user1.address);
      expect((await vaultFactoryContract.feeToUpdateTime()).toString()).to.be.equal(expectedFeeToUpdateTime.toString());
    });
    
    it("should update proposed feeTo address", async function () {
      const { feeRole, user1, vaultFactoryContract } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(feeRole).proposeNewAdminFeeAddress(user1.address);
      // --------------- Proposed FeeTo ----------------- //
      await time.increase(constants.UPDATE_TIME_FACTORY);
      await vaultFactoryContract.updateNewAdminFeeAddress();
      const _newFeeTo = await vaultFactoryContract.feeTo();
      expect(_newFeeTo).to.be.equal(user1.address);
      expect(await vaultFactoryContract.feeToUpdateTime()).to.be.equal(ethers.constants.Zero.toString());
    });
    
    it("should fail to update feeTo address if UPDATE_TIME hasn't passed", async function () {
      const { feeRole, user1, vaultFactoryContract } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(feeRole).proposeNewAdminFeeAddress(user1.address);
      // --------------- Proposed FeeTo ----------------- //
      await expect(vaultFactoryContract.updateNewAdminFeeAddress()).to.be.revertedWith("Factory: UPDATE_TIME");
    });
    
    it("should fail to update feeTo address if not proposed", async function () {
      const { vaultFactoryContract } = await loadFixture(deployNibblVaultFactoryFixture);
      await expect(vaultFactoryContract.updateNewAdminFeeAddress()).to.be.revertedWith("Factory: !Proposed");
    });
    
    it("should propose admin fee", async function () {
      const { vaultFactoryContract, feeRole } = await loadFixture(deployNibblVaultFactoryFixture);
      const _newFee = 1_000;
      await vaultFactoryContract.connect(feeRole).proposeNewAdminFee(_newFee);
      const blockTime = await time.latest();
      const expectedFeeToUpdateTime = blockTime + constants.UPDATE_TIME_FACTORY; // expectedFeeToUpdateTime is latest + UPDATE_TIME_FACTORY
      expect(await vaultFactoryContract.pendingFeeAdmin()).to.be.equal(_newFee);
      expect((await vaultFactoryContract.feeAdminUpdateTime()).toString()).to.be.equal(expectedFeeToUpdateTime.toString());
    });
    
    
    it("should update admin fee", async function () {
      const { vaultFactoryContract, feeRole } = await loadFixture(deployNibblVaultFactoryFixture);
      const _newFee = 1_000;
      await vaultFactoryContract.connect(feeRole).proposeNewAdminFee(_newFee);
      // Proposed new Admin Fee
      await time.increase(constants.UPDATE_TIME_FACTORY);
      await vaultFactoryContract.updateNewAdminFee();
      expect(await vaultFactoryContract.feeAdmin()).to.equal(_newFee);
      expect(await vaultFactoryContract.feeAdminUpdateTime()).to.be.equal(ethers.constants.Zero.toString());
    });
    
    it("should fail to propose admin fee if fee greater than MAX_ADMIN_FEE", async function () {
      const { vaultFactoryContract, feeRole } = await loadFixture(deployNibblVaultFactoryFixture);
      const _newFee = 25_000;
      await expect(vaultFactoryContract.connect(feeRole).proposeNewAdminFee(_newFee)).to.be.revertedWith("Factory: Fee too high");
    });
    
    it("should fail to update fee if UPDATE_TIME hasn't passed", async function () {
      const { vaultFactoryContract, feeRole } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(feeRole).proposeNewAdminFee(1_000);
      await expect(vaultFactoryContract.updateNewAdminFee()).to.be.revertedWith("Factory: UPDATE_TIME");
    });

    it("should fail to update fee if not proposed", async function () {
      const { vaultFactoryContract, feeRole } = await loadFixture(deployNibblVaultFactoryFixture);
      await expect(vaultFactoryContract.updateNewAdminFee()).to.be.revertedWith("Factory: !Proposed");
    });
    
    it("should propose nibblVaultImplementation", async function () {
      const { vaultFactoryContract, implementationRole, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(implementationRole).proposeNewVaultImplementation(user1.address);
      const expectedVaultUpdateTime = (await time.latest()) + constants.UPDATE_TIME_FACTORY;
      expect(await vaultFactoryContract.pendingVaultImplementation()).to.be.equal(user1.address);
      expect((await vaultFactoryContract.vaultUpdateTime()).toString()).to.be.equal(expectedVaultUpdateTime.toString());
    });
    
    it("should update nibblVaultImplementation", async function () {
      const { vaultFactoryContract, implementationRole, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(implementationRole).proposeNewVaultImplementation(user1.address);
      // Proposed New Vault Implementation
      await time.increase(constants.UPDATE_TIME_FACTORY);
      await vaultFactoryContract.updateVaultImplementation();
      expect(await vaultFactoryContract.vaultImplementation()).to.equal(user1.address);
      expect((await vaultFactoryContract.vaultUpdateTime()).toString()).to.equal(ethers.constants.Zero.toString());
    });
    
    it("should fail to update nibblVaultImplementation if UPDATE_TIME hasn't passed", async function () {
      const { vaultFactoryContract, implementationRole, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(implementationRole).proposeNewVaultImplementation(user1.address);
      await expect(vaultFactoryContract.updateVaultImplementation()).to.be.revertedWith("Factory: UPDATE_TIME");
    });
    
    it("should fail to update nibblVaultImplementation if not proposed", async function () {
      const { vaultFactoryContract } = await loadFixture(deployNibblVaultFactoryFixture);
      await expect(vaultFactoryContract.updateVaultImplementation()).to.be.revertedWith("Factory: !Proposed");
    });
    
    it("should propose basketVaultImplementation", async function () {
      const { vaultFactoryContract, implementationRole, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(implementationRole).proposeNewBasketImplementation(user1.address);
      const expectedBasketUpdateTime = (await time.latest()) + constants.UPDATE_TIME_FACTORY;
      expect(await vaultFactoryContract.pendingBasketImplementation()).to.be.equal(user1.address);
      expect(await vaultFactoryContract.basketUpdateTime()).to.be.equal(expectedBasketUpdateTime.toString());
    });
    
    it("should update nibblBasketImplementation", async function () {
      const { vaultFactoryContract, implementationRole, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(implementationRole).proposeNewBasketImplementation(user1.address);
      await time.increase(constants.UPDATE_TIME_FACTORY);
      await vaultFactoryContract.updateBasketImplementation();
      expect(await vaultFactoryContract.basketImplementation()).to.equal(user1.address);
      expect((await vaultFactoryContract.basketUpdateTime()).toString()).to.equal(ethers.constants.Zero.toString());
    });
    
    it("should fail to update nibblBasketImplementation if UPDATE_TIME hasn't passed", async function () {
      const { vaultFactoryContract, implementationRole, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(implementationRole).proposeNewBasketImplementation(user1.address);
      await expect(vaultFactoryContract.updateBasketImplementation()).to.be.revertedWith("Factory: UPDATE_TIME");
    });
    
    it("should fail to update nibblBasketImplementation if not proposed", async function () {
      const { vaultFactoryContract } = await loadFixture(deployNibblVaultFactoryFixture);
      await expect(vaultFactoryContract.updateBasketImplementation()).to.be.revertedWith("Factory: !Proposed");
    });
  });
  
  describe("Access Control Mechanism", function () {
    
    it("should allow admin to change RoleAdmin", async function () {
      const { vaultFactoryContract, admin } = await loadFixture(deployNibblVaultFactoryFixture);
      // Make PAUSER_ROLE admin for IMPLEMENTER_ROLE
      await vaultFactoryContract.connect(admin).setRoleAdmin(await vaultFactoryContract.IMPLEMENTER_ROLE(), await vaultFactoryContract.PAUSER_ROLE());
      expect(await vaultFactoryContract.getRoleAdmin(await vaultFactoryContract.IMPLEMENTER_ROLE())).to.equal(await vaultFactoryContract.PAUSER_ROLE());    
    });

    it("should only allow RoleAdmin to change RoleAdmin", async function () {
      const { vaultFactoryContract, feeRole } = await loadFixture(deployNibblVaultFactoryFixture);
      // Only RoleAdmin can set RoleAdmin
      await expect(vaultFactoryContract.connect(feeRole).setRoleAdmin(await vaultFactoryContract.IMPLEMENTER_ROLE(), await vaultFactoryContract.PAUSER_ROLE())).to.be.reverted;    
    });

    it("should allow admin to propose role", async function () {
      const { vaultFactoryContract, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
      const implementorRole = await vaultFactoryContract.IMPLEMENTER_ROLE();
      await vaultFactoryContract.proposeGrantRole(implementorRole, user1.address);
      expect(await vaultFactoryContract.pendingRoles(implementorRole, user1.address)).to.be.true
    });
    
    it("should allow only admin to propose role", async function () {
      const { vaultFactoryContract, user1, user2 } = await loadFixture(deployNibblVaultFactoryFixture);
      const implementorRole = await vaultFactoryContract.IMPLEMENTER_ROLE();
      await expect(vaultFactoryContract.connect(user2).proposeGrantRole(implementorRole, user1.address)).to.be.reverted;
    });
    
    it("should allow claiming proposed roles", async function () {
      const { vaultFactoryContract, user1, admin } = await loadFixture(deployNibblVaultFactoryFixture);
      const implementorRole = await vaultFactoryContract.IMPLEMENTER_ROLE();
      await vaultFactoryContract.connect(admin).proposeGrantRole(implementorRole, user1.address);
      await vaultFactoryContract.connect(user1).claimRole(implementorRole);
      expect(await vaultFactoryContract.hasRole(implementorRole, user1.address)).to.be.true;
    });
    

    it("should allow claiming only if proposed roles", async function () {
      const { vaultFactoryContract, user1 } = await loadFixture(deployNibblVaultFactoryFixture);
      const implementorRole = await vaultFactoryContract.IMPLEMENTER_ROLE();
      await expect(vaultFactoryContract.connect(user1).claimRole(implementorRole)).to.be.revertedWith("AccessControl: Role not pending");
    });
    
  });

  describe("Pausing", function () {
    it("should allow PAUSER_ROLE to pause", async function () {
      const { vaultFactoryContract, pausingRole } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(pausingRole).pause();
      expect(await vaultFactoryContract.paused()).to.be.equal(true);
    });

    it("should allow PAUSER_ROLE to unpause", async function () {
      const { vaultFactoryContract, pausingRole } = await loadFixture(deployNibblVaultFactoryFixture);
      await vaultFactoryContract.connect(pausingRole).pause();
      await vaultFactoryContract.connect(pausingRole).unPause();
      expect(await vaultFactoryContract.paused()).to.be.equal(false);
    });
    
  });

});
