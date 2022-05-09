import { expect } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, Contract, Signer, VoidSigner } from 'ethers';
import { mintTokens, burnTokens, snapshot, restore, getBigNumber, TWO, ONE, latest } from "./helper";
import * as constants from "./constants";
import { getSignatureParameters } from './helper/getSignatureParameters';


describe("NibblTokenVault: Permit ", function () {
    let accounts: Signer[];
    let snapshotId: Number;
    let user: any;
    let spender: Signer;
    let erc721: Contract;
    let vaultContract: Contract;
    let vaultImplementationContract: Contract;
    let vaultFactoryContract: Contract;
    
    let userAddress: string;

    let domain: Object;
    let types: Object;

    before(async function () {
        accounts = await ethers.getSigners();   
        user = accounts[0];
        spender = accounts[1];

        userAddress = await user.getAddress();

        const Erc721 = await ethers.getContractFactory("ERC721Token");
        erc721 = await Erc721.deploy();
        await erc721.deployed(); 

        await erc721.mint(await user.getAddress(), 0);

        const NibblVault = await ethers.getContractFactory("NibblVault");
        vaultImplementationContract = await NibblVault.deploy();
        await vaultImplementationContract.deployed();

        const NibblVaultFactory = await ethers.getContractFactory("NibblVaultFactory");

        const Basket = await ethers.getContractFactory("Basket");
        const basketImplementationContract = await Basket.deploy();
        await basketImplementationContract.deployed();
        
        vaultFactoryContract = await NibblVaultFactory.connect(user).deploy(vaultImplementationContract.address,
                                                                            userAddress,
                                                                            userAddress,
                                                                            basketImplementationContract.address); 

        await vaultFactoryContract.deployed();
        
        await erc721.approve(vaultFactoryContract.address, 0);

        await vaultFactoryContract.connect(user).createVault(erc721.address,
            userAddress,
            constants.tokenName,
            constants.tokenSymbol,
            0,
            constants.initialTokenSupply,
            constants.initialTokenPrice,
            await latest(),
            { value: constants.initialSecondaryReserveBalance });

        const proxyAddress = await vaultFactoryContract.getVaultAddress(await user.getAddress(), erc721.address, 0, constants.initialTokenSupply, constants.initialTokenPrice);
        
        vaultContract = new ethers.Contract(proxyAddress.toString(), NibblVault.interface, user);
        
        domain = {
            name: 'NibblVault',
            version: '1',
            chainId: 31337,
            verifyingContract: vaultContract.address,
        };
        types = {
            Permit: [
                { name: 'owner', type: 'address' },
                { name: 'spender', type: 'address' },
                { name: 'value', type: 'uint256' },
                { name: 'nonce', type: 'uint256' },
                { name: 'deadline', type: 'uint256' }
            ],
        };
    });
    
    beforeEach(async function () {
        snapshotId = await snapshot();        
    });

    afterEach(async function () {
        await restore(snapshotId);
    });

    it("Should approve spender via permit", async function () {

        const nonce = await vaultContract.nonces(await user.getAddress());
        const permit = {
            owner: await user.getAddress(),
            spender: await spender.getAddress(),
            value: ethers.utils.parseEther("1"),
            nonce: nonce,
            deadline: (await latest()).add(getBigNumber(1000, 1))
        }

        const signature = await user._signTypedData(domain, types, permit);
        const {r, s, v} = getSignatureParameters(signature);
        await vaultContract.permit(
            permit.owner,
            permit.spender,
            permit.value,
            permit.deadline,
            v,
            r,
            s);

        expect(await vaultContract.allowance(permit.owner, permit.spender)).to.be.equal(permit.value);
        expect(await vaultContract.nonces(permit.owner)).to.be.equal(nonce.add(ONE));
    })

    it("Should revert if permit expired", async function () {
        const nonce = await vaultContract.nonces(await user.getAddress());
        const permit = {
            owner: await user.getAddress(),
            spender: await spender.getAddress(),
            value: ethers.utils.parseEther("1"),
            nonce: nonce,
            deadline: (await latest()).sub(getBigNumber(1000, 1))
        }

        const signature = await user._signTypedData(domain, types, permit);
        const {r, s, v} = getSignatureParameters(signature);
        await expect(vaultContract.permit(
            permit.owner,
            permit.spender,
            permit.value,
            permit.deadline,
            v,
            r,
            s)).to.be.revertedWith("NibblVault: expired deadline");

    })


    it("Should revert if permit expired", async function () {
        const nonce = await vaultContract.nonces(await user.getAddress());
        const permit = {
            owner: await spender.getAddress(),
            spender: await spender.getAddress(),
            value: ethers.utils.parseEther("1"),
            nonce: nonce,
            deadline: (await latest()).add(getBigNumber(1000, 1))
        }

        const signature = await user._signTypedData(domain, types, permit);
        const {r, s, v} = getSignatureParameters(signature);
        await expect(vaultContract.permit(
            permit.owner,
            permit.spender,
            permit.value,
            permit.deadline,
            v,
            r,
            s)).to.be.revertedWith("NibblVault: invalid signature");

    })

// 

});