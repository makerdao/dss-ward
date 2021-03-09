const Web3 = require('web3');
const settings = require('../settings.js');
const fs = require('fs');
const fetch = require('node-fetch');
const treeify = require('treeify');
const Diff = require('diff');
const chalk = require('chalk');

const allLogs = [];
const scannedAddresses = [];

const getJson = path => {
  return JSON.parse(fs.readFileSync(path));
}

const parseWho = (web3, chainLog) => {
  let who;
  if (process.argv.length > 2) {
    who = process.argv[2];
  } else {
    return null;
  }
  let address;
  if (isAddress(who)) {
    address = web3.utils.toChecksumAddress(who);
  } else if (['full', 'oracles'].includes(who)) {
    return who;
  } else {
    address = getKey(chainLog, who);
    if (!address) {
      console.log(`${ who } isn't an address nor does it exist in the`
                  + ` chainlog.`);
      process.exit();
    }
  }
  return address;
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

const getAddresses = (web3, log) => {
  const addresses = [];
  for (const topic of log.topics) {
    if (topic.match(/^0x0{24}/)) {
      const address = `0x${ topic.substring(26, 66) }`;
      const checksumAddress = web3.utils.toChecksumAddress(address);
      addresses.push(checksumAddress);
    }
  }
  return addresses;
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

const getLogs = async (web3, chainLog, addresses) => {
  const who = addresses.length === 1
        ? await getWho(chainLog, addresses[0])
        : `${ addresses.length } addresses`;
  let logs = [];
  const logNoteSig = getSig(web3, 'rely(address)');
  const eventSig = web3.utils.sha3('Rely(address)');
  const topics = [ [logNoteSig, eventSig] ];
  const end = await web3.eth.getBlockNumber();
  const { mcdDeployment } = settings;
  let fromBlock = mcdDeployment;
  const totalBlocks = end - fromBlock;
  let toBlock = 0;
  const startTime = new Date();
  while (toBlock < end) {
    toBlock = fromBlock + settings.batchSize;
    const blocksProcessed = fromBlock - mcdDeployment;
    const progress = 100 * blocksProcessed / totalBlocks;
    process.stdout.write(`getting logNote and event relies for ${ who }... `
                         + `${ progress.toFixed(1) }%\r`);
    const batch = await web3.eth.getPastLogs(
      {
        fromBlock,
        toBlock: Math.min(toBlock, end),
        address: addresses,
        topics,
      }
    );
    logs = logs.concat(batch);
    fromBlock = toBlock + 1;
  }
  const endTime = new Date();
  const span = Math.floor((endTime - startTime) / 1000);
  process.stdout.write(`getting logNote and event relies for ${ who }... `);
  console.log(`found ${ logs.length } relies in ${ span } seconds`);
  return logs;
}

const getRelies = async (web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  const relies = [];
  let logs;
  if (scannedAddresses.includes(address)) {
    logs = allLogs.filter(log => log.address === address);
    console.log(`getting logNote and event relies for ${ who }... `
                + `found ${ logs.length } cached logs`);
  } else {
    logs = await getLogs(web3, chainLog, [ address ]);
    allLogs[address] = logs;
  }
  for (const log of logs) {
    const addresses = getAddresses(web3, log);
    relies.push(...addresses);
  }
  const uniqueRelies = Array.from(new Set(relies));
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
    console.log('no owner');
  }
  process.stdout.write(`getting authority for ${ who }... `);
  try {
    const authority = await contract.methods.authority().call();
    console.log(getWho(chainLog, authority));
    if (Number(authority) != 0) {
      authorities.push(authority);
    }
  } catch (err) {
    console.log('no authority');
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
  const abi = getJson('./lib/dss-chain-log/out/ChainLog.abi');
  const contract = new web3.eth.Contract(abi, address);
  const start = new Date();
  let hasWards = true;
  let count = 1;
  for (const suspect of suspects) {
    const progress = Math.floor(100 * count / suspects.length);
    count ++;
    process.stdout.write(`checking wards for ${ who }... ${ progress }%\r`);
    try {
      const relied = await isWard(contract, suspect);
      if (relied) {
        relies.push(suspect);
      }
    } catch (err) {
      console.log(`checking wards for ${ who }... no wards`);
      hasWards = false;
      break;
    }
  }
  const end = new Date();
  const span = Math.floor((end - start) / 1000);
  if (hasWards) {
    console.log(`checking wards for ${ who }... found ${ relies.length }`
                + ` wards in ${ span } seconds`);
  }
  return relies;
}

const getWards = async (env, web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  if (who !== address) {
    console.log(`\nstarting check for ${ who } (${ address })`);
  } else {
    console.log(`\nstarting check for address ${ address }...`);
  }
  let suspects = [];
  const deployers = await getDeployers(env, web3, chainLog, address);
  suspects = suspects.concat(deployers);
  const authorities = await getAuthorities(web3, chainLog, address);
  const relies = await getRelies(web3, chainLog, address);
  suspects = suspects.concat(relies);
  const uniqueSuspects = Array.from(new Set(suspects));
  const wards = await checkSuspects(web3, chainLog, address, uniqueSuspects);
  const allWards = wards.concat(authorities).filter(w => w != address);
  return allWards;
}

const treeLookup = async (env, web3, chainLog, vatAddress) => {
  const tree = {};
  tree[vatAddress] = 'new';
  while (Object.values(tree).includes('new')) {
    const addresses = Object.keys(tree).filter(addr => tree[addr] === 'new');
    if (addresses.length > 1) {
      console.log();
      allLogs.push(...await getLogs(web3, chainLog, addresses));
      scannedAddresses.push(...addresses);
    }
    for (const address of addresses) {
      tree[address] = await getWards(env, web3, chainLog, address);
      for (const child of tree[address]) {
        if (!tree[child]) {
          tree[child] = 'new';
        }
      }
    }
  }
  return tree;
}

const getOracleAddresses = async (web3, chainLog) => {
  const oracles = [];
  for (const address of Object.keys(chainLog)) {
    const who = chainLog[address];
    if (who.startsWith('PIP_')) {
      console.log(`${ who } (${ address })`);
      oracles.push(address);
      process.stdout.write('orbs: ');
      const abi = getJson('./lib/univ2-lp-oracle/out/UNIV2LPOracle.abi');
      const contract = new web3.eth.Contract(abi, address);
      try {
        const orb0 = await contract.methods.orb0().call();
        const orb1 = await contract.methods.orb1().call();
        oracles.push(orb0);
        oracles.push(orb1);
        chainLog[orb0] = who + '_ORB0';
        chainLog[orb1] = who + '_ORB1';
        console.log([orb0, orb1], '\n');
      } catch (err) {
        console.log('no orbs');
        process.stdout.write('source: ');
        try {
          const source = await contract.methods.src().call();
          oracles.push(source);
          chainLog[source] = who + '_SRC';
          console.log(source, '\n');
        } catch (err) {
          console.log('no source\n');
        }
      }
    }
  }
  return oracles;
}

const getBranch = (tree, node, parents) => {
  const branch = {};
  for (const subNode of tree[node]) {
    if (parents.includes(subNode)) continue;
    branch[subNode] = getBranch(tree, subNode, [...parents, node]);
  }
  return branch;
}

const compareResults = next => {
  const prev = fs.readFileSync('log/latest.txt', 'utf8');
  console.log();
  if (next === prev) {
    console.log(next);
    console.log('no changes from last lookup');
  } else {
    const diff = Diff.diffChars(prev, next);
    diff.forEach(part => {
      const text = part.added
            ? chalk.green(part.value)
            : part.removed
            ? chalk.red(part.value)
            : chalk.grey(part.value);
      process.stdout.write(text);
    });
    console.log('\nchanges detected from last lookup');
    fs.writeFileSync(`log/${ new Date().getTime() }.txt`, next);
    fs.writeFileSync('log/latest.txt', next);
  }
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
  const address = parseWho(web3, chainLog);
  if (!address || address === 'full') {
    console.log('performing full system lookup...');
    const vatAddress = getKey(chainLog, 'MCD_VAT');
    const tree = await treeLookup(env, web3, chainLog, vatAddress);
    const namedTree = {};
    for (const address of Object.keys(tree)) {
      const who = getWho(chainLog, address);
      namedTree[who] = tree[address].map(address => getWho(chainLog, address));
    }
    const hier = getBranch(namedTree, 'MCD_VAT', []);
    const result = 'MCD_VAT\n' + treeify.asTree(hier);
    compareResults(result);
  } else if (address === 'oracles') {
    console.log('checking oracles...\n');
    const addresses = await getOracleAddresses(web3, chainLog);
    for (const address of addresses) {
      const wards = await getWards(env, web3, chainLog, address);
      const who = getWho(chainLog, address);
      console.log(`the following addresses have direct privileged access to `
                  + `${ who }:`);
      console.log(wards.map(ward => getWho(chainLog, ward)));
      console.log();
    }
  } else {
    const who = getWho(chainLog, address);
    const wards = await getWards(env, web3, chainLog, address);
    console.log(`the following addresses have direct privileged access to `
                + `${ who }:`);
    console.log(wards.map(ward => getWho(chainLog, ward)));
  }
}

ward();
