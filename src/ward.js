const Web3 = require('web3');
const settings = require('../settings.js');
const fs = require('fs');

const getChainLogAbi = () => {
  return new Promise((resolve, reject) => {
    const chainLogPath = './lib/dss-chain-log/out/ChainLog.abi';
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

const getSig = (web3, funcWithParams) => {
  const hash = web3.utils.sha3(funcWithParams);
  const sig = hash.substring(0, 10);
  const paddedSig = `${ sig }${ '0'.repeat(56) }`
  return paddedSig;
}

const getAddress = log => {
  const argument = log.topics[1];
  const length = argument.length;
  const address = `0x${argument.substring(length - 40, length)}`;
  return address;
}

const getAddresses = async (web3, chainLog, what, who) => {
  const hexWho = web3.utils.toHex(who);
  const address = await chainLog.methods.getAddress(hexWho).call();
  const addresses = [];
  const sig = getSig(web3, `${ what }(address)`);
  process.stdout.write(`getting ${ what }s for ${ who }... `);
  const start = new Date();
  const logs = await web3.eth.getPastLogs({
    fromBlock: 0,
    address,
    topics: [ sig ],
  });
  const end = new Date();
  console.log(`done in ${ (end - start) / 1000 } seconds.`);
  for (const log of logs) {
    const address = getAddress(log);
    addresses.push(address);
  }
  return addresses;
}

const ward = async () => {
  const chainLogAbi = await getChainLogAbi();
  const env = getEnv();
  const web3 = new Web3(env.rpcUrl);
  const chainLog = new web3.eth.Contract(chainLogAbi, settings.chainLogAddress);

  const relies = await getAddresses(web3, chainLog, 'rely', 'MCD_VAT');
  const denies = await getAddresses(web3, chainLog, 'deny', 'MCD_VAT');
  const currentRelies = relies.filter(rely => !denies.includes(rely));
  console.log(relies);
  console.log(denies);
  console.log(currentRelies);
}

ward();
