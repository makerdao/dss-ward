const Web3 = require('web3');
const settings = require('../settings.js');
const fs = require('fs');
const fetch = require('node-fetch');

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

const getArgs = (web3, chainLog) => {
  let who = 'MCD_VAT';
  if (process.argv.length > 2) {
    who = process.argv[2];
  }
  if (isAddress(who)) {
    return { address: web3.utils.toChecksumAddress(who) };
  }
  const address = getKey(chainLog, who);
  if (!address) {
    console.log(`${ who } isn't an address nor does it exist in the chainlog.`);
    process.exit();
  }
  return { address };
}

const getEnv = () => {
  const vars = [ 'ETH_RPC_URL', 'ETHERSCAN_API_KEY' ];
  const env = {};
  for (const v of vars) {
    if (!process.env[v]) {
      console.log(`please specify a ${v} env var`);
      process.exit();
    }
    env[v] = process.env[v];
  }
  return env;
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
    process.stdout.write(`downloading the chainlog... ${ progress }%\r`);
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

const getWho = (chainLog, address) => {
  return chainLog[address] || address;
}

const getLogNoteRelies = async (web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  const authorizations = [];
  const sig = getSig(web3, 'rely(address)');
  process.stdout.write(`getting logNote relies for ${ who }... `);
  const start = new Date();
  const logs = await web3.eth.getPastLogs({
    fromBlock: 11800000,
    address,
    topics: [ sig ],
  });
  const end = new Date();
  const span = Math.floor((end - start) / 1000);
  console.log(`found ${ logs.length } relies in ${ span } seconds`);
  for (const log of logs) {
    const address = getAddress(web3, log);
    authorizations.push(address);
  }
  return authorizations;
}

const getDeployer = async (env, web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  process.stdout.write(`getting deployer for ${ who }... `);
  const endpoint = 'https://api.etherscan.io/api';
  const fixedEntries = 'module=account&action=txlistinternal&startblock=0'
        + '&sort=asc';
  const addressEntry = `address=${ address }`;
  const keyEntry = `apiKey=${env.ETHERSCAN_API_KEY}`;
  const url = `${ endpoint }?${ fixedEntries }&${ addressEntry }&${ keyEntry }`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status != '1') {
    console.error(data.message);
    return '0x0';
  }
  const txs = data.result;
  for (const tx of txs) {
    if (tx.type === 'create') {
      const deployer = web3.utils.toChecksumAddress(tx.from);
      console.log(getWho(chainLog, deployer));
      return deployer;
    }
  }
  console.error('not found');
  return '0x0';
}

const isWard = async (contract, suspect) => {
  const ward = await contract.methods.wards(suspect).call();
  return ward != 0;
}

const checkSuspects = async (web3, chainLog, address, suspects) => {
  const who = getWho(chainLog, address);
  process.stdout.write(`checking wards for ${ who }... `);
  const start = new Date();
  const relies = [];
  const abi = await getChainLogAbi();
  const contract = new web3.eth.Contract(abi, address);
  for (const suspect of suspects) {
    const relied = await isWard(contract, suspect);
    if (relied) {
      relies.push(suspect);
    }
  }
  const end = new Date();
  const time = Math.floor((end - start) / 1000);
  console.log(`found ${ relies.length } wards in ${ time } seconds`);
  return relies;
}

const getWards = async (env, web3, chainLog, address) => {
  const deployer = await getDeployer(env, web3, chainLog, address);
  const suspects = await getLogNoteRelies(web3, chainLog, address);
  suspects.push(deployer);
  const wards = checkSuspects(web3, chainLog, address, suspects);
  return wards;
}

const ward = async () => {
  const env = getEnv();
  const web3 = new Web3(env.ETH_RPC_URL);
  const chainLog = JSON.parse(fs.readFileSync('chainLog.json', 'utf8'));
  // const chainLog = await getChainLog(web3);
  // fs.writeFileSync('chainLog.json', JSON.stringify(chainLog));
  const args = getArgs(web3, chainLog);
  const wards = await getWards(env, web3, chainLog, args.address);
  console.log(wards.map(rely => getWho(chainLog, rely)));
}

ward();
