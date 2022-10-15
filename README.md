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
    1. Can the contract can break somehow due to upgrading
    2. Storage Collisions
2. New Twav System
    1. Things we should keep in mind while upgrading the TWAV system
3. Accounting for ERC1155 Wraps
4. Reentrancy in ERC1155Link
5. We have added 2 new modifiers in NibblVault2 [OnlyCurator](https://www.notion.so/ERC1155-Link-audit-216b906702ec43c39af991ec60feeefd) and [OnlyBidder](https://github.com/NibblNFT/erc1155Link-audit/blob/cccc326031068fde6578b7c0232d0ecf5bb87143/contracts/NibblVault2.sol#L181)
    
    → Can this cause any issue as we were using require statements in earlier NibblVault.sol