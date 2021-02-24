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

const getAddress = (web3, log) => {
  const argument = log.topics[1];
  const length = argument.length;
  const address = `0x${argument.substring(length - 40, length)}`;
  const checksumAddress = web3.utils.toChecksumAddress(address);
  return checksumAddress;
}

const getChainLog = async web3 => {
  const chainLog = {};
  const abi = await getChainLogAbi();
  const contract = new web3.eth.Contract(abi, settings.chainLogAddress);
  const count = await contract.methods.count().call();
  for (let i = 0; i < count; i ++) {
    const progress = Math.floor(100 * i / count);
    process.stdout.write(`Downloading the chainlog... ${ progress }%\r`);
    const result = await contract.methods.get(i).call();
    const address = result['1'];
    const nameHex = result['0'];
    const name = web3.utils.hexToUtf8(nameHex);
    chainLog[address] = name;
  }
  console.log();
  return chainLog;
}

const getKey = (object, value) => {
  return Object.keys(object).find(key => object[key] === value);
}

const getAuthorizations = async (web3, chainLog, what, who) => {
  const address = getKey(chainLog, who);
  const authorizations = [];
  const sig = getSig(web3, `${ what }(address)`);
  const subWhat = what.substring(0, what.length - 1);
  process.stdout.write(`getting ${ subWhat }es for ${ who }... `);
  const start = new Date();
  const logs = await web3.eth.getPastLogs({
    fromBlock: 11800000,
    address,
    topics: [ sig ],
  });
  const end = new Date();
  console.log(`done in ${ Math.floor((end - start) / 1000) } seconds.`);
  for (const log of logs) {
    const address = getAddress(web3, log);
    const name = chainLog[address];
    authorizations.push(name || address);
  }
  return authorizations;
}

const ward = async () => {
  const env = getEnv();
  const web3 = new Web3(env.rpcUrl);
  const chainLog = await getChainLog(web3);

  const relies = await getAuthorizations(web3, chainLog, 'rely', 'MCD_VAT');
  const denies = await getAuthorizations(web3, chainLog, 'deny', 'MCD_VAT');
  const currentRelies = relies.filter(rely => !denies.includes(rely));
  console.log(relies);
  console.log(denies);
  console.log(currentRelies);
}

ward();
