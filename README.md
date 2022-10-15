# ERC1155 Link audit

Status: In progress

## Scope

- NibblVault2.sol
- Twav/Twav2.sol
- Proxy/ProxyERC1155Link.sol
- ERC1155Link.sol
- Upgradeablity

## Areas of concern

1. Upgradeability
    1. Can the contract break somehow due to upgrading from NibblVault1 to NibblVault2
    2. Storage Collisions
2. New Twav System
    1. Things we should keep in mind while upgrading the TWAV system
3. Accounting for ERC1155 Wraps
4. Reentrancy in ERC1155Link
5. Can Vault contract be exploited somehow by ERC1155 Link?
6. We have added 2 new modifiers in NibblVault2 [OnlyCurator](https://github.com/NibblNFT/erc1155Link-audit/blob/86a60087fd4214733af363abb0508cf785cd03e1/contracts/NibblVault2.sol#L176) and [OnlyBidder](https://github.com/NibblNFT/erc1155Link-audit/blob/cccc326031068fde6578b7c0232d0ecf5bb87143/contracts/NibblVault2.sol#L181)
    
    → Can this cause any issue as we were using require statements in earlier NibblVault.sol

## New Code and concerns in NibblVault2
1. Introduced a variable to cover storage gap from EIP712 contract inherited in NibblVault1.
https://github.com/NibblNFT/erc1155Link-audit/blob/86a60087fd4214733af363abb0508cf785cd03e1/contracts/NibblVault2.sol#L28

2. Introduced a immutable variable for storing the ERC1155Link Implementation
https://github.com/NibblNFT/erc1155Link-audit/blob/86a60087fd4214733af363abb0508cf785cd03e1/contracts/NibblVault2.sol#L63

3. A new variable for storing address to linked ERC1155
https://github.com/NibblNFT/erc1155Link-audit/blob/86a60087fd4214733af363abb0508cf785cd03e1/contracts/NibblVault2.sol#L144

4. 2 new Modifiers and removing code from functions.
https://github.com/NibblNFT/erc1155Link-audit/blob/86a60087fd4214733af363abb0508cf785cd03e1/contracts/NibblVault2.sol#L176
