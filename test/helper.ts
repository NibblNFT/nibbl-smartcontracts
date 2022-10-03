import { BigNumber, BigNumberish } from "ethers";
import { NibblVault, NibblVault2 } from "../typechain-types";
import { initialTokenSupply, primaryReserveRatio, SCALE } from "./constants";

export function getBigNumber(amount: BigNumberish, decimals = 18): BigNumber {
  return BigNumber.from(amount).mul(BigNumber.from(10).pow(decimals));
}

export async function getCurrentValuation(vault: NibblVault | NibblVault2) {
    return (await vault.totalSupply()).lt(initialTokenSupply) ? ((await vault.secondaryReserveBalance()).mul(SCALE).div(await vault.secondaryReserveRatio())) : ((await vault.primaryReserveBalance()).mul(SCALE).div(primaryReserveRatio));
}