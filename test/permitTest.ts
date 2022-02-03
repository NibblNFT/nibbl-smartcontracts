import { expect } from "chai";
import { ethers, network } from 'hardhat';
import { BigNumber } from "ethers";
import { mintTokens, burnTokens } from "./testHelpers/singleCurveTokenVaultHelper";
import { setTime , increaseTime } from "./testHelpers/time";
import { TWAV } from "./testHelpers/twavHelper";
import { getSignatureParameters } from "./testHelpers/getSignatureParameters";

describe("Buyout", function () {
  const tokenName = "NibblToken";
  const tokenSymbol = "NIBBL";
  const SCALE: BigNumber = BigNumber.from(1e6);
  const decimal = BigNumber.from((1e18).toString());
  const FEE_ADMIN: BigNumber = BigNumber.from(2_000);
  const FEE_CURVE: BigNumber = BigNumber.from(4_000);
  const MAX_FEE_CURATOR: BigNumber = BigNumber.from(4_000);
  const rejectionPremium: BigNumber = BigNumber.from(100_000);
  const primaryReserveRatio: BigNumber = BigNumber.from(500_000);
  const BUYOUT_DURATION: BigNumber = BigNumber.from(3 * 24 * 60 * 60);   
  const THREE_MINS: BigNumber = BigNumber.from(180)
  let blockTime: BigNumber = BigNumber.from(Math.ceil((Date.now() / 1e3)));
  const initialTokenPrice: BigNumber = BigNumber.from((1e14).toString()); //10 ^-4 eth
  const initialValuation: BigNumber = BigNumber.from((1e20).toString()); //100 eth
  const initialTokenSupply: BigNumber = initialValuation.div(initialTokenPrice).mul(decimal);
  const initialSecondaryReserveBalance: BigNumber = ethers.utils.parseEther("10");
  const initialSecondaryReserveRatio: BigNumber = initialSecondaryReserveBalance.mul(SCALE).div(initialValuation);
  const primaryReserveBalance: BigNumber = primaryReserveRatio.mul(initialValuation).div(SCALE);
  const fictitiousPrimaryReserveBalance = primaryReserveRatio.mul(initialValuation).div(SCALE);
    const FEE_CURATOR: BigNumber = initialSecondaryReserveRatio.mul(BigNumber.from("10000")).div(primaryReserveRatio);


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

    this.domain = {
        name: 'NibblVault',
        version: '1',
        chainId: 31337,
        verifyingContract: this.tokenVault.address,
    };
    
    this.types = {
        Permit: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'deadline', type: 'uint256' }
        ],
      };


  });

    it("Should approve spender via permit", async function () {
      const permit = {
        owner: this.curator.address,
        spender: this.addr1.address,
        value: ethers.utils.parseEther("1"),
        nonce: 0,
        deadline: "100000000000000"
      }

      //   let signature = await this.curator._signTypedData(this.domain, this.types, permit);
      //   const r = signature.slice(0, 66);
      //   const s = "0x".concat(signature.slice(66, 130));
      //   const v = "0x".concat(signature.slice(130, 132));

        // _PERMIT_TYPEHASH = keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");


      const signature = await this.curator._signTypedData(this.domain, this.types, permit);
      const {r, s, v} = getSignatureParameters(signature);
      await this.tokenVault.permit(
        permit.owner,
        permit.spender,
        permit.value,
        permit.deadline,
         v,
         r,
         s);
        // function allowance(address owner, address spender) public view virtual override returns (uint256) {

      expect(await this.tokenVault.allowance(permit.owner, permit.spender)).to.be.equal(permit.value);
    })
});