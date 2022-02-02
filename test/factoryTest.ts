import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import {
  mintTokens,
  burnTokens,
} from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime } from "./testHelpers/time";
import { TWAV } from "./testHelpers/twavHelper";

describe("NibblVaultFactory", function () {
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e6);
  const ONE = BigNumber.from(1);
  const decimal = BigNumber.from((1e18).toString());
  const MAX_FEE_ADMIN: BigNumber = BigNumber.from(2_000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4_000);
  const MAX_FEE_CURVE: BigNumber = BigNumber.from(4_000);
  
  const rejectionPremium: BigNumber = BigNumber.from(100_000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500_000);
  const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
  const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
  const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
  const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
  const requiredReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
  const primaryReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const fictitiousPrimaryReserveBalance = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const FEE_CURVE: BigNumber = BigNumber.from(4_000);
  const FEE_CURATOR: BigNumber = initialSecondaryReserveRatio.lt(BigNumber.from(100_000)) ? initialSecondaryReserveRatio.div(BigNumber.from(10)) : BigNumber.from(10_000);
  const FEE_ADMIN: BigNumber = BigNumber.from(2_000);
  let blockTime: BigNumber = BigNumber.from(Math.ceil((Date.now() / 1e3)));
  const THREE_MINS: BigNumber = BigNumber.from(180);
  const TWO_DAYS: BigNumber = BigNumber.from(2 * 24 * 60 * 60);

  // (primaryReserveRatio * initialTokenSupply * INITIAL_TOKEN_PRICE) / (SCALE * 1e18);

  beforeEach(async function () {
    const [curator, admin, buyer1, buyer2, addr1, implementerRole, feeRole, pauserRole] = await ethers.getSigners();
    this.curator = curator;
    this.admin = admin;
    this.buyer1 = buyer1;
    this.buyer2 = buyer2;
    this.addr1 = addr1;
    this.implementerRole = implementerRole;
    this.feeRole = feeRole;
    this.pauserRole = pauserRole;

//     DEFAULT_ADMIN_ROLE
// FEE_ROLE
// PAUSER_ROLE
// IMPLEMENTER_ROLE

    this.NFT = await ethers.getContractFactory("NFT");
    this.nft = await this.NFT.deploy();
    await this.nft.deployed();
    await this.nft.mint(this.curator.address, 0);

    this.NibblVault = await ethers.getContractFactory("NibblVault");
    this.nibblVaultImplementation = await this.NibblVault.deploy();
    await this.nibblVaultImplementation.deployed();
// Basket
    this.Basket = await ethers.getContractFactory("Basket");
    this.basketImplementation = await this.Basket.deploy();
    await this.basketImplementation.deployed();

    this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    this.tokenVaultFactory = await this.NibblVaultFactory.connect(this.curator).deploy(this.nibblVaultImplementation.address, this.basketImplementation.address, this.admin.address, this.admin.address); 
    await this.tokenVaultFactory.deployed();
    await this.tokenVaultFactory.connect(this.admin).grantRole(await this.tokenVaultFactory.FEE_ROLE(), this.feeRole.address);
    await this.tokenVaultFactory.connect(this.admin).grantRole(await this.tokenVaultFactory.PAUSER_ROLE(), this.pauserRole.address);
    await this.tokenVaultFactory.connect(this.admin).grantRole(await this.tokenVaultFactory.IMPLEMENTER_ROLE(), this.implementerRole.address);
    // grantRole(bytes32 role, address account)
    await this.nft.approve(this.tokenVaultFactory.address, 0);

    this.TestBancorBondingCurve = await ethers.getContractFactory("TestBancorBondingCurve");
    this.TestTWAVContract = await ethers.getContractFactory("TestTwav");
    this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
    this.testTWAV = await this.TestTWAVContract.deploy();
    await this.testTWAV.deployed();
    await this.testBancorBondingCurve.deployed();

    await this.tokenVaultFactory.createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply,10**14, {value: initialSecondaryReserveBalance});
    const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
    this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.NibblVault.interface, this.curator);
    this.twav = new TWAV();
  });

  it("should propose feeTo address", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.connect(this.feeRole).proposeNewAdminFeeAddress(this.addr1.address);
    const pendingFeeTo = await this.tokenVaultFactory.pendingFeeTo();
    const feeToUpdateTime = await this.tokenVaultFactory.feeToUpdateTime();
    expect(pendingFeeTo).to.be.equal(this.addr1.address);
    expect(feeToUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
  });

  it("should update proposed feeTo address", async function () {
    blockTime = await this.testTWAV.getCurrentBlockTime();
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.connect(this.admin).connect(this.feeRole).proposeNewAdminFeeAddress(this.addr1.address);
    const pendingFeeTo = await this.tokenVaultFactory.pendingFeeTo();
    const feeToUpdateTime = await this.tokenVaultFactory.feeToUpdateTime();
    expect(pendingFeeTo).to.be.equal(this.addr1.address);
    expect(feeToUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
    // --------------- Proposed FeeTo ----------------- //
    blockTime = blockTime.add(TWO_DAYS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.updateNewAdminFeeAddress();
    const feeTo = await this.tokenVaultFactory.feeTo();
    expect(feeTo).to.be.equal(this.addr1.address);
  });

  it("should fail to update feeTo address if UPDATE_TIME hasn't passed", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.connect(this.feeRole).proposeNewAdminFeeAddress(this.addr1.address);
    const pendingFeeTo = await this.tokenVaultFactory.pendingFeeTo();
    const feeToUpdateTime = await this.tokenVaultFactory.feeToUpdateTime();
    expect(pendingFeeTo).to.be.equal(this.addr1.address);
    expect(feeToUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
    // --------------- Proposed FeeTo ----------------- //
    await expect(this.tokenVaultFactory.updateNewAdminFeeAddress()).to.be.revertedWith("NibblVaultFactory: UPDATE_TIME has not passed");
  });

  it("should propose new admin fee", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const _newFee = 1_000;
    await this.tokenVaultFactory.connect(this.feeRole).proposeNewAdminFee(_newFee);
    const pendingFeeAdmin = await this.tokenVaultFactory.pendingFeeAdmin();
    const feeAdminUpdateTime = await this.tokenVaultFactory.feeAdminUpdateTime();
    expect(pendingFeeAdmin).to.be.equal(_newFee);
    expect(feeAdminUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
  });

  it("should fail to propose new admin fee is fee greater than MAX_ADMIN_FEE", async function () {
    const _newFee = 10_000;
    await expect(this.tokenVaultFactory.connect(this.feeRole).proposeNewAdminFee(_newFee)).to.be.revertedWith("NibblVaultFactory: Fee value greater than MAX_ADMIN_FEE");
  });

  it("should update new admin fee", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const _newFee = 1_000;
    await this.tokenVaultFactory.connect(this.feeRole).proposeNewAdminFee(_newFee);
    const pendingFeeAdmin = await this.tokenVaultFactory.pendingFeeAdmin();
    const feeAdminUpdateTime = await this.tokenVaultFactory.feeAdminUpdateTime();
    expect(pendingFeeAdmin).to.be.equal(_newFee);
    expect(feeAdminUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
    blockTime = blockTime.add(TWO_DAYS);
    await setTime(blockTime.toNumber());

    await this.tokenVaultFactory.updateNewAdminFee();
    expect(await this.tokenVaultFactory.feeAdmin()).to.equal(_newFee);
  });
  
  it("should fail to update feeTo address if UPDATE_TIME hasn't passed", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    const _newFee = 1_000;
    await this.tokenVaultFactory.connect(this.feeRole).proposeNewAdminFee(_newFee);
    const pendingFeeAdmin = await this.tokenVaultFactory.pendingFeeAdmin();
    const feeAdminUpdateTime = await this.tokenVaultFactory.feeAdminUpdateTime();
    expect(pendingFeeAdmin).to.be.equal(_newFee);
    expect(feeAdminUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
    await expect(this.tokenVaultFactory.updateNewAdminFee()).to.be.revertedWith("NibblVaultFactory: UPDATE_TIME has not passed");
  });

  it("should withdraw admin fee", async function () {
    const _buyAmount = ethers.utils.parseEther("1000");
    const _feeAmountAdmin = _buyAmount.mul(FEE_ADMIN).div(SCALE);
    await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
    const _initialBalanceFactory = await this.admin.provider.getBalance(this.tokenVaultFactory.address);
    await this.tokenVaultFactory.connect(this.admin).withdrawAdminFee();
    const _finalBalanceFactory = await this.admin.provider.getBalance(this.tokenVaultFactory.address);
    expect(_initialBalanceFactory).to.be.equal(_finalBalanceFactory.add(_feeAmountAdmin));
  });
  
  it("should propose nibblVaultImplementation", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.connect(this.implementerRole).proposeNewVaultImplementation(this.addr1.address);
    const pendingVaultImplementation = await this.tokenVaultFactory.pendingVaultImplementation();
    const vaultUpdateTime = await this.tokenVaultFactory.vaultUpdateTime();
    expect(pendingVaultImplementation).to.be.equal(this.addr1.address);
    expect(vaultUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
  });

  it("should update nibblVaultImplementation", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.connect(this.implementerRole).proposeNewVaultImplementation(this.addr1.address);
    const pendingVaultImplementation = await this.tokenVaultFactory.pendingVaultImplementation();
    const vaultUpdateTime = await this.tokenVaultFactory.vaultUpdateTime();
    expect(pendingVaultImplementation).to.be.equal(this.addr1.address);
    expect(vaultUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
    blockTime = blockTime.add(TWO_DAYS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.updateVaultImplementation();
    expect(await this.tokenVaultFactory.vaultImplementation()).to.equal(this.addr1.address);
  });

  it("should fail to update nibblVaultImplementation if UPDATE_TIME hasn't passed", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.connect(this.implementerRole).proposeNewVaultImplementation(this.addr1.address);
    const pendingVaultImplementation = await this.tokenVaultFactory.pendingVaultImplementation();
    const vaultUpdateTime = await this.tokenVaultFactory.vaultUpdateTime();
    expect(pendingVaultImplementation).to.be.equal(this.addr1.address);
    expect(vaultUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));

    await expect(this.tokenVaultFactory.updateVaultImplementation()).to.be.revertedWith("NibblVaultFactory: UPDATE_TIME has not passed");
  });

  it("should propose basketImplementation", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.connect(this.implementerRole).proposeNewBasketImplementation(this.addr1.address);
    const pendingBasketImplementation = await this.tokenVaultFactory.pendingBasketImplementation();
    const basketUpdateTime = await this.tokenVaultFactory.basketUpdateTime();
    expect(pendingBasketImplementation).to.be.equal(this.addr1.address);
    expect(basketUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
  });

  it("should update basketImplementation", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.connect(this.implementerRole).proposeNewBasketImplementation(this.addr1.address);
    const pendingBasketImplementation = await this.tokenVaultFactory.pendingBasketImplementation();
    const basketUpdateTime = await this.tokenVaultFactory.basketUpdateTime();
    expect(pendingBasketImplementation).to.be.equal(this.addr1.address);
    expect(basketUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
    blockTime = blockTime.add(TWO_DAYS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.updateBasketImplementation();
    expect(await this.tokenVaultFactory.basketImplementation()).to.equal(this.addr1.address);
  });

  it("should fail to update basketImplementation if UPDATE_TIME hasn't passed", async function () {
    blockTime = blockTime.add(THREE_MINS);
    await setTime(blockTime.toNumber());
    await this.tokenVaultFactory.connect(this.implementerRole).proposeNewBasketImplementation(this.addr1.address);
    const pendingBasketImplementation = await this.tokenVaultFactory.pendingBasketImplementation();
    const basketUpdateTime = await this.tokenVaultFactory.basketUpdateTime();
    expect(pendingBasketImplementation).to.be.equal(this.addr1.address);
    expect(basketUpdateTime).to.be.equal(blockTime.add(TWO_DAYS));
    await expect(this.tokenVaultFactory.updateBasketImplementation()).to.be.revertedWith("NibblVaultFactory: UPDATE_TIME has not passed");
  });


  it("should fail to create a vault if initial balance is too low", async function () {
    await expect(this.tokenVaultFactory.connect(this.curator).createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply, 10 ** 14, { value: 0 })).to.be.revertedWith("NibblVaultFactory: Initial reserve balance too low");
    let _erc721ArrayAddress: string[] = [];
    let _erc721ArrayTokenIDs: number[] = [];
    for (let index = 1; index < 10; index++) {
        await this.nft.mint(this.curator.address, index);
        _erc721ArrayAddress.push(this.nft.address);
        _erc721ArrayTokenIDs.push(index);
    }
    for (let index = 1; index < 10; index++) {
        await this.nft.approve(this.tokenVaultFactory.address, index);
    }
    await expect(this.tokenVaultFactory.createMultiVaultERC721(_erc721ArrayAddress, _erc721ArrayTokenIDs, tokenName, tokenSymbol, initialTokenSupply, 10**14, {value: 0})).to.be.revertedWith("NibblVaultFactory: Initial reserve balance too low");
  });

  it("should allow default admin to be able to change RoleAdmin", async function () {
    await this.tokenVaultFactory.connect(this.admin).setRoleAdmin(await this.tokenVaultFactory.IMPLEMENTER_ROLE(), await this.tokenVaultFactory.PAUSER_ROLE());
    expect(await this.tokenVaultFactory.getRoleAdmin(await this.tokenVaultFactory.IMPLEMENTER_ROLE())).to.equal(await this.tokenVaultFactory.PAUSER_ROLE());    
  });

  it("should allow RoleAdmin to grantRole", async function () {
    await this.tokenVaultFactory.connect(this.admin).grantRole(await this.tokenVaultFactory.IMPLEMENTER_ROLE(), this.addr1.address);
    expect(await this.tokenVaultFactory.hasRole(await this.tokenVaultFactory.IMPLEMENTER_ROLE(), this.addr1.address)).to.equal(true);    
  });

  it("should allow RoleAdmin to revokeRole", async function () {
    await this.tokenVaultFactory.connect(this.admin).grantRole(await this.tokenVaultFactory.IMPLEMENTER_ROLE(), this.addr1.address);
    expect(await this.tokenVaultFactory.hasRole(await this.tokenVaultFactory.IMPLEMENTER_ROLE(), this.addr1.address)).to.equal(true);    
    //
    await this.tokenVaultFactory.connect(this.admin).revokeRole(await this.tokenVaultFactory.IMPLEMENTER_ROLE(), this.addr1.address);
    expect(await this.tokenVaultFactory.hasRole(await this.tokenVaultFactory.IMPLEMENTER_ROLE(), this.addr1.address)).to.equal(false);    
    
  });
  


});
