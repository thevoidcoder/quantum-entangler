require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

const BSC_MAINNET_RPC = process.env.BSC_MAINNET_RPC || "https://bsc-mainnet.public.blastapi.io";
const BSC_TESTNET_RPC = process.env.BSC_TESTNET_RPC || "https://bsc-testnet.blockpi.network/v1/rpc/public";

/** @type import('hardhat/config').HardhatUserConfig */
const config = {
  solidity: {
    version: "0.8.23",
    settings: {
      optimizer: {
        enabled: true,
        runs: 500
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: process.env.BSC_FORK_RPC
        ? {
            url: process.env.BSC_FORK_RPC,
            blockNumber: process.env.BSC_FORK_BLOCK ? Number(process.env.BSC_FORK_BLOCK) : undefined
          }
        : undefined
    },
    bsctestnet: {
      url: BSC_TESTNET_RPC,
      accounts: process.env.BSC_TESTNET_PRIVATE_KEY ? [process.env.BSC_TESTNET_PRIVATE_KEY] : []
    }
  }
};

module.exports = config;
