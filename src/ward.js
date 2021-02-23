const Web3 = require('web3');
const settings = require('../settings.js');

const getEnv = () => {
  if (!process.env.ETH_RPC_URL) {
    console.log('please specify a ETH_RPC_URL env var');
    process.exit();
  }
  return {
    rpcUrl: process.env.ETH_RPC_URL,
  }
}

const env = getEnv();
const web3 = new Web3(env.rpcUrl);
