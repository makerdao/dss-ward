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

const getArgs = chainLog => {
  let who = 'MCD_VAT';
  if (process.argv.length > 2) {
    who = process.argv[2];
  }
  if (isAddress(who)) {
    return { address: who };
  }
  const address = getKey(chainLog, who);
  if (!address) {
    console.log(`${ who } isn't an address nor does it exist in the chainlog.`);
    process.exit();
  }
  return { address };
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

const isAddress = string => {
  return Boolean(string.match('^0x[0-9a-fA-F]{40}$'))
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

const getLogNote = async (web3, chainLog, what, address) => {
  const who = chainLog[address] || address;
  const authorizations = [];
  const sig = getSig(web3, `${ what }(address)`);
  const whats = what.replace('y', 'ies');
  process.stdout.write(`getting logNote ${ whats } for ${ who }... `);
  const start = new Date();
  const logs = await web3.eth.getPastLogs({
    fromBlock: 0,
    address,
    topics: [ sig ],
  });
  const end = new Date();
  const span = Math.floor((end - start) / 1000);
  console.log(`found ${ logs.length } ${ whats } in ${ span } seconds.`);
  for (const log of logs) {
    const address = getAddress(web3, log);
    const name = chainLog[address];
    authorizations.push(name || address);
  }
  return authorizations;
}

const getCurrentRelies = async (web3, chainLog, address) => {
  const relies = await getLogNote(web3, chainLog, 'rely', address);
  console.log(relies);
  const denies = await getLogNote(web3, chainLog, 'deny', address);
  console.log(denies);
  const currentRelies = relies.filter(rely => !denies.includes(rely));
  return currentRelies;
}

const ward = async () => {
  const env = getEnv();
  const web3 = new Web3(env.rpcUrl);
  // const chainLog = JSON.parse(fs.readFileSync('chainLog.json', 'utf8'));
  const chainLog = await getChainLog(web3);
  // fs.writeFileSync('chainLog.json', JSON.stringify(chainLog));
  const args = getArgs(chainLog);
  const currentRelies = await getCurrentRelies(web3, chainLog, args.address);
  console.log(currentRelies);
}

ward();
