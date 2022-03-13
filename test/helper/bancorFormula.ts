import { BigNumber, Contract } from "ethers";


export const mintTokens = async (testBondingCurve: Contract,  continuousTokenSupply:BigNumber, reserveTokenBalance:BigNumber, reserveRatio: BigNumber, amount: BigNumber) : Promise<BigNumber> => {
        return (await testBondingCurve.calculatePurchaseReturn(continuousTokenSupply, reserveTokenBalance, reserveRatio, amount))
}

export const burnTokens = async (testBondingCurve: Contract, continuousTokenSupply: BigNumber, reserveTokenBalance: BigNumber, reserveRatio: BigNumber, amount: BigNumber): Promise<BigNumber> => {
        return (await testBondingCurve.calculateSaleReturn(continuousTokenSupply, reserveTokenBalance, reserveRatio, amount))
}
