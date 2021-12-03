// SPDX-License-Identifier: GPL-3.0

pragma solidity 0.8.4;

library DataStructure {
    
    struct Fee{
        uint32 feeAdmin;
        uint32 feeCurator;
    }

    struct Asset{
        address assetAddress;
        uint256 assetTokenID;
    }

  
}