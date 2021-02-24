const Web3 = require('web3');
const settings = require('../settings.js');
const fs = require('fs');
const fetch = require('node-fetch');

const getJson = path => {
  return JSON.parse(fs.readFileSync(path));
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
  const abi = getJson('./lib/dss-chain-log/out/ChainLog.abi');
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
  process.stdout.write(`getting logNote relies for ${ who }... `);
  const relies = [];
  const sig = getSig(web3, 'rely(address)');
  const start = new Date();
  const logs = await web3.eth.getPastLogs({
    fromBlock: settings.fromBlock,
    address,
    topics: [ sig ],
  });
  const end = new Date();
  const span = Math.floor((end - start) / 1000);
  console.log(`found ${ logs.length } relies in ${ span } seconds`);
  for (const log of logs) {
    const address = getAddress(web3, log);
    relies.push(address);
  }
  return relies;
}

const getEventRelies = async (web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  process.stdout.write(`getting event relies for ${ who }... `);
  const abi = getJson('./lib/univ2-lp-oracle/out/UNIV2LPOracle.abi');
  const contract = new web3.eth.Contract(abi, address);
  const start = new Date();
  const events = await contract.getPastEvents('Rely', {
    fromBlock: settings.fromBlock,
  });
  const end = new Date();
  const span = Math.floor((end - start) / 1000);
  console.log(`found ${ events.length } relies in ${ span } seconds`);
  const relies = events.map(event => event.returnValues['0']);
  return relies;
}

const getAuthorities = async (web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  const abi = getJson('./lib/ds-pause/out/DSPause.abi');
  const contract = new web3.eth.Contract(abi, address);
  const authorities = [];
  let owner;
  process.stdout.write(`getting owner for ${ who }... `);
  try {
    owner = await contract.methods.owner().call();
    console.log(getWho(chainLog, owner));
    if (Number(owner) != 0) {
      authorities.push(owner);
    }
  } catch (err) {
    if (err.data === 'Reverted 0x') {
      console.log('no owner');
    }
  }
  process.stdout.write(`getting authority for ${ who }... `);
  try {
    const authority = await contract.methods.authority().call();
    console.log(getWho(chainLog, authority));
    if (Number(authority) != 0) {
      authorities.push(authority);
    }
  } catch (err) {
    if (err.data === 'Reverted 0x') {
      console.log('no authority');
    }
  }
  return authorities;
}

const getTxs = async (env, address, internal) => {
  const endpoint = 'https://api.etherscan.io/api';
  const fixedEntries = 'module=account&startblock=0&sort=asc';
  const actionEntry = `action=txlist${ internal ? 'internal' : '' }`;
  const addressEntry = `address=${ address }`;
  const keyEntry = `apiKey=${env.ETHERSCAN_API_KEY}`;
  const url = `${ endpoint }?${ fixedEntries }&${ actionEntry }`
        + `&${ addressEntry }&${ keyEntry }`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.status != '1') {
    if (data.message === 'No transactions found') {
      return [];
    }
    console.error(data.message);
    process.exit();
  }
  const txs = data.result;
  return txs;
}

const getDeployers = async (env, web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  process.stdout.write(`getting deployer for ${ who }... `);
  const regularTxs = await getTxs(env, address, false);
  const internalTxs = await getTxs(env, address, true);
  const txs = regularTxs.concat(internalTxs);
  const deployTxs = txs.filter(tx =>
    tx.type === 'create' || tx.to === ''
  );
  const deployers = deployTxs.map(tx => web3.utils.toChecksumAddress(tx.from));
  console.log(deployers.map(deployer => getWho(chainLog, deployer)));
  return deployers;
}

const isWard = async (contract, suspect) => {
  const ward = await contract.methods.wards(suspect).call();
  return ward != 0;
}

const checkSuspects = async (web3, chainLog, address, suspects) => {
  const who = getWho(chainLog, address);
  const relies = [];
  let wardsPresent = true;
  const abi = getJson('./lib/dss-chain-log/out/ChainLog.abi');
  const contract = new web3.eth.Contract(abi, address);
  process.stdout.write(`checking wards for ${ who }... `);
  const start = new Date();
  for (const suspect of suspects) {
    try {
      const relied = await isWard(contract, suspect);
      if (relied) {
        relies.push(suspect);
      }
    } catch (err) {
      if (err.data === 'Reverted 0x') {
        console.log('no wards');
        wardsPresent = false;
        break;
      }
    }
  }
  const end = new Date();
  const time = Math.floor((end - start) / 1000);
  if (wardsPresent) {
    console.log(`found ${ relies.length } wards in ${ time } seconds`);
  }
  return relies;
}

const getWards = async (env, web3, chainLog, address) => {
  let suspects = [];
  const deployers = await getDeployers(env, web3, chainLog, address);
  suspects = suspects.concat(deployers);
  const logNoteRelies = await getLogNoteRelies(web3, chainLog, address);
  suspects = suspects.concat(logNoteRelies);
  const eventRelies = await getEventRelies(web3, chainLog, address);
  suspects = suspects.concat(eventRelies);
  const uniqueSuspects = Array.from(new Set(suspects));
  const wards = await checkSuspects(web3, chainLog, address, uniqueSuspects);
  const authorities = await getAuthorities(web3, chainLog, address);
  return wards.concat(authorities);
}

const ward = async () => {
  const env = getEnv();
  const web3 = new Web3(env.ETH_RPC_URL);
  let chainLog;
  if (settings.cachedChainLog) {
    chainLog = JSON.parse(fs.readFileSync('chainLog.json', 'utf8'));
  } else {
    chainLog = await getChainLog(web3);
    fs.writeFileSync('chainLog.json', JSON.stringify(chainLog));
  }
  const args = getArgs(web3, chainLog);
  const wards = await getWards(env, web3, chainLog, args.address);
  console.log(wards.map(rely => getWho(chainLog, rely)));
}

ward();
