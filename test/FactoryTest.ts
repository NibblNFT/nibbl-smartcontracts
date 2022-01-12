import { expect } from "chai";
import { ethers, network } from "hardhat";
import { BigNumber } from "ethers";
import {
  mintTokens,
  burnTokens,
} from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime } from "./testHelpers/time";

describe("NibblVaultFactory", function () {
  type TwavObservation = {
    timestamp: BigNumber;
    cumulativeValuation: BigNumber;
  };
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e6);
  const ONE = BigNumber.from(1);
  const decimal = BigNumber.from((1e18).toString());

  const FEE_ADMIN: BigNumber = BigNumber.from(2000);
  const FEE_CURATOR: BigNumber = BigNumber.from(4000);
  const FEE_CURVE: BigNumber = BigNumber.from(4000);

  const MAX_FEE_ADMIN: BigNumber = BigNumber.from(2000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4000);
  const MAX_FEE_CURVE: BigNumber = BigNumber.from(4000);
  const rejectionPremium: BigNumber = BigNumber.from(100000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500000);

  const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
  const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
  const initialTokenSupply: BigNumber = initialValuation
    .div(initialTokenPrice)
    .mul(decimal);
  const initialSecondaryReserveBalance: BigNumber =
    ethers.utils.parseEther("10");
  const requiredReserveBalance: BigNumber = primaryReserveRatio
    .mul(initialValuation)
    .div(SCALE);
  const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance
    .mul(SCALE)
    .div(initialValuation);
  const primaryReserveBalance: BigNumber = primaryReserveRatio
    .mul(initialValuation)
    .div(SCALE);
  const fictitiousPrimaryReserveBalance = primaryReserveRatio
    .mul(initialValuation)
    .div(SCALE);

  // (primaryReserveRatio * initialTokenSupply * INITIAL_TOKEN_PRICE) / (SCALE * 1e18);

  beforeEach(async function () {
    const [curator, admin, buyer1, addr1, addr2, addr3, addr4] =
      await ethers.getSigners();
    this.curator = curator;
    this.admin = admin;
    this.buyer1 = buyer1;
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

    this.Basket = await ethers.getContractFactory("Basket");
    this.basketImplementation = await this.Basket.deploy();
    await this.basketImplementation.deployed();

    this.NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");
    this.tokenVaultFactory = await this.NibblVaultFactory.deploy(this.nibblVaultImplementation.address, this.basketImplementation.address, this.admin.address);
    await this.tokenVaultFactory.deployed();
      
    this.nft.approve(this.tokenVaultFactory.address, 0);

    this.TestBancorBondingCurve = await ethers.getContractFactory(
      "TestBancorBondingCurve"
    );
    this.TestTWAPContract = await ethers.getContractFactory("TestTwav");
    this.testBancorBondingCurve = await this.TestBancorBondingCurve.deploy();
    this.testTWAV = await this.TestTWAPContract.deploy();
    await this.testTWAV.deployed();
    await this.testBancorBondingCurve.deployed();

    await this.tokenVaultFactory.createVault(
      this.nft.address,
      0,
      tokenName,
      tokenSymbol,
      initialTokenSupply,
      10 ** 14,
      MAX_FEE_CURATOR,
      { value: initialSecondaryReserveBalance }
    );
    const proxyAddress = await this.tokenVaultFactory.nibbledTokens(0);
    this.tokenVault = new ethers.Contract(
      proxyAddress.toString(),
      this.NibblVault.interface,
      this.curator
    );
  });
  it("updates admin fee address", async function () {
    await this.tokenVaultFactory
      .connect(this.curator)
      .updateAdminFeeAddress(this.addr1.address);
    
    const updatedFeeTo = await this.tokenVaultFactory.feeTo();
    expect(updatedFeeTo).to.be.equal(this.addr1.address);
  });
  it("updates admin fee percentage", async function () {
    const _buyAmount = ethers.utils.parseEther("1");
    const _newFee = 1000;
    await this.tokenVaultFactory.connect(this.curator).updateFee(_newFee);
    const balanceBeforeTx = await this.admin.provider.getBalance(
      this.admin.address
    );
    await this.tokenVault
      .connect(this.buyer1)
      .buy(0, this.buyer1.address, { value: _buyAmount });
    const balanceAfterTx = await this.admin.provider.getBalance(
      this.admin.address
    );
    expect(balanceAfterTx.sub(balanceBeforeTx)).to.be.equal(
      _buyAmount.mul(_newFee).div(SCALE)
    );
  });
  it("Transaction fails when more than MAX value is set for admin fees ", async function () {
    const _newFee = 2001
    await expect(this.tokenVaultFactory.connect(this.curator).updateFee(_newFee)).to.be.revertedWith("NibblVaultFactory: New fee value is greater than max fee allowed");
  });
});
