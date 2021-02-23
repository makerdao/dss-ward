const Web3 = require('web3');
const settings = require('../settings.js');
const fs = require('fs');

const getChainLogAbi = () => {
  return new Promise((resolve, reject) => {
    const chainLogPath = '../lib/dss-chain-log/out/ChainLog.abi';
    fs.readFile(chainLogPath, (err, byteData) => {
      if (err) reject(err);
      else {
        const stringData = byteData.toString();
        const jsonData = JSON.parse(stringData);
        resolve(jsonData);
      }
    });
  });
}

const getEnv = () => {
  if (!process.env.ETH_RPC_URL) {
    console.log('please specify a ETH_RPC_URL env var');
    process.exit();
  }
  return {
    rpcUrl: process.env.ETH_RPC_URL,
  }
}

const ward = async () => {
  const abi = await getChainLogAbi();
  const env = getEnv();
  const web3 = new Web3(env.rpcUrl);
  const chainLog = new web3.eth.Contract(abi, settings.chainLogAddress);
  const hexVat = web3.utils.toHex('MCD_VAT');
  const vatAddress = await chainLog.methods.getAddress(hexVat).call();
  console.log(vatAddress);
}

ward();
