import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import {
  mintTokens,
  burnTokens,
} from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime } from "./testHelpers/time";

describe("Curator Fees", function () {
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e9);
  const ONE = BigNumber.from(1);
  const decimal = BigNumber.from((1e18).toString());
  const FEE_ADMIN: BigNumber = BigNumber.from(2_000_000);
  const FEE_CURATOR: BigNumber = BigNumber.from(4_000_000);
  const FEE_CURVE: BigNumber = BigNumber.from(4_000_000);
  const MAX_FEE_ADMIN: BigNumber = BigNumber.from(2_000_000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4_000_000);
  const MAX_FEE_CURVE: BigNumber = BigNumber.from(4_000_000);
  const rejectionPremium: BigNumber = BigNumber.from(100_000_000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500_000_000);
  const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
  const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
  const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
  const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
  const requiredReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
  const primaryReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const fictitiousPrimaryReserveBalance = primaryReserveRatio.mul(initialValuation).div(SCALE);

  // (primaryReserveRatio * initialTokenSupply * INITIAL_TOKEN_PRICE) / (SCALE * 1e18);

  beforeEach(async function () {
    const [curator, admin, buyer1, buyer2, addr1, addr2, addr3, addr4] = await ethers.getSigners();
    this.curator = curator;
    this.admin = admin;
    this.buyer1 = buyer1;
    this.buyer2 = buyer2;
    this.addr1 = addr1;
    this.addr2 = addr2;
    this.addr3 = addr3;
    this.addr4 = addr4;

    this.NFT = await ethers.getContractFactory("NFT");
    this.nft = await this.NFT.deploy();
    await this.nft.deployed();
    this.nft.mint(this.curator.address, 0);

    this.NibblVault = await ethers.getContractFactory("NibblVault");
    this.nibblVaultImplementation = await this.NibblVault.deploy();
    await this.nibblVaultImplementation.deployed();
// Basket
    this.Basket = await ethers.getContractFactory("Basket");
    this.basketImplementation = await this.Basket.deploy();
    await this.basketImplementation.deployed();

    this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    this.tokenVaultFactory = await this.NibblVaultFactory.deploy(this.nibblVaultImplementation.address, this.basketImplementation.address, this.admin.address);
    await this.tokenVaultFactory.deployed();
    this.nft.approve(this.tokenVaultFactory.address, 0);

    this.TestBancorBondingCurve = await ethers.getContractFactory("TestBancorBondingCurve");
    this.TestTWAVContract = await ethers.getContractFactory("TestTwav");
    this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
    this.testTWAV = await this.TestTWAVContract.deploy();
    await this.testTWAV.deployed();
    await this.testBancorBondingCurve.deployed();

    await this.tokenVaultFactory.createVault(this.nft.address, 0, tokenName, tokenSymbol, initialTokenSupply, 10 ** 14, MAX_FEE_CURATOR, { value: initialSecondaryReserveBalance });
    const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
    this.tokenVault = new ethers.Contract(proxyAddress.toString(), this.NibblVault.interface, this.curator);
  });

  it("should update curator fee", async function () {
    const newFee = 3_000_000;
    await this.tokenVault.connect(this.curator).updateCuratorFee(newFee);
    const curatorFeeFromContract = await this.tokenVault.curatorFee();
    expect(curatorFeeFromContract).to.be.equal(newFee);
  });

  it("should fail to update curator fee if Invalid", async function () {
    const newFee = 5_000_001;
    await expect(this.tokenVault.connect(this.curator).updateCuratorFee(newFee)).to.be.revertedWith("NibblVault: Invalid fee");
  });

  it("should accure and redeem curator fee correctly", async function () {
    const _buyAmount = ethers.utils.parseEther("1");
    await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
    const expectedFee = _buyAmount.mul(MAX_FEE_CURATOR).div(SCALE);
    expect(await this.tokenVault.feeAccruedCurator()).to.be.equal(expectedFee);
    await this.tokenVault.connect(this.curator).redeemCuratorFee(this.curator.address);
    const accuredFeeAfterRedeem = await this.tokenVault.feeAccruedCurator();
    expect(accuredFeeAfterRedeem).to.be.equal(0);
  });

  it("should fail to update curator if msg.sender isn't curator", async function () {
    const newFee = 10000;
    await expect(this.tokenVault.connect(this.addr1).updateCuratorFee(newFee)).to.be.revertedWith("NibblVault: Only Curator");
  });

  it("should withdraw curator fee", async function () {
    const _buyAmount = ethers.utils.parseEther("100000");
    const _expectedFee = _buyAmount.mul(MAX_FEE_CURATOR).div(SCALE);
    const initialBalanceAddr1 = await this.admin.provider.getBalance(this.addr1.address);
    await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
    expect(await this.tokenVault.feeAccruedCurator()).to.be.equal(_expectedFee);
    await this.tokenVault.redeemCuratorFee(this.addr1.address);
    expect(await this.admin.provider.getBalance(this.addr1.address)).to.equal(initialBalanceAddr1.add(_expectedFee));
  });

  it("should withdraw curator fee", async function () {
    const _buyAmount = ethers.utils.parseEther("100000");
    const _expectedFee = _buyAmount.mul(MAX_FEE_CURATOR).div(SCALE);
    const initialBalanceAddr1 = await this.admin.provider.getBalance(this.addr1.address);
    await this.tokenVault.connect(this.buyer1).buy(0, this.buyer1.address, { value: _buyAmount });
    expect(await this.tokenVault.feeAccruedCurator()).to.be.equal(_expectedFee);
    await this.tokenVault.redeemCuratorFee(this.addr1.address);
    expect(await this.admin.provider.getBalance(this.addr1.address)).to.equal(initialBalanceAddr1.add(_expectedFee));
  });

});
