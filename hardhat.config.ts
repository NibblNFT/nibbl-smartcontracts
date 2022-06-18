import * as dotenv from "dotenv";

import { HardhatUserConfig, task } from "hardhat/config";
import "@nomiclabs/hardhat-waffle";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "hardhat-contract-sizer";
import "hardhat-docgen";

dotenv.config();

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.10",
    settings: {
      optimizer: {
        enabled: true,
        runs: 100,
      }
    }
  },
  networks: {
    hardhat: {
      accounts: {
        accountsBalance: "10000000000000000000000000000"
      },
    },
    // mumbai: {
    //   url: `${process.env.MUMBAI_URL}`,
    //   accounts: [`${process.env.PRIVATE_KEY}`],
    // },
    // rinkeby: {
    //   url: `${process.env.RINKEBY_URL}`,
    //   accounts: [`${process.env.PRIVATE_KEY}`],
    // }
  },

  gasReporter: {
    currency: 'USD',
    gasPrice: 100,
  },


};

export default config;