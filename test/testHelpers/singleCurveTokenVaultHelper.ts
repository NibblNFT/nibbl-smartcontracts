import { BigNumber, Contract } from "ethers";


export const mintTokens = async (testBondingCurve: Contract,  continuousTokenSupply:BigNumber, reserveTokenBalance:BigNumber, reserveRatio: BigNumber, amount: BigNumber) : Promise<BigNumber> => {
        return (await testBondingCurve._calculatePurchaseReturn(continuousTokenSupply, reserveTokenBalance, reserveRatio, amount))
}

export const burnTokens = async (testBondingCurve: Contract, continuousTokenSupply: BigNumber, reserveTokenBalance: BigNumber, reserveRatio: BigNumber, amount: BigNumber): Promise<BigNumber> => {
        //        uint256 _supply,
        // uint256 _reserveBalance,
        // uint32 _reserveRatio,
        // uint256 _sellAmount
        return (await testBondingCurve._calculateSaleReturn(continuousTokenSupply, reserveTokenBalance, reserveRatio, amount))

}
