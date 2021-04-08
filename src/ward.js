const { ArgumentParser } = require('argparse');
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

const getChainLog = async (args, web3) => {
  if (args.debug === 'read') {
    return JSON.parse(fs.readFileSync('chainLog.json', 'utf8'));
  }
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
  if (args.debug === 'write') {
    fs.writeFileSync('chainLog.json', JSON.stringify(chainLog));
  }
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
    scannedAddresses.push(address);
  }
  for (const log of logs) {
    const addresses = getAddresses(web3, log);
    relies.push(...addresses);
  }
  const uniqueRelies = Array.from(new Set(relies));
  return relies;
}

const getOwner = async (web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  const abi = getJson('./lib/ds-pause/out/DSPause.abi');
  const contract = new web3.eth.Contract(abi, address);
  process.stdout.write(`getting owner for ${ who }... `);
  try {
    const owner = await contract.methods.owner().call();
    console.log(getWho(chainLog, owner));
    if (Number(owner) != 0) {
      return owner;
    }
  } catch (err) {
    console.log('no owner');
  }
  return null;
}

const getAuthority = async (web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  const abi = getJson('./lib/ds-pause/out/DSPause.abi');
  const contract = new web3.eth.Contract(abi, address);
  process.stdout.write(`getting authority for ${ who }... `);
  try {
    const authority = await contract.methods.authority().call();
    console.log(getWho(chainLog, authority));
    if (Number(authority) != 0) {
      return authority;
    }
  } catch (err) {
    console.log('no authority');
  }
  return null;
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
  let suspects = [];
  const deployers = await getDeployers(env, web3, chainLog, address);
  suspects = suspects.concat(deployers);
  const relies = await getRelies(web3, chainLog, address);
  suspects = suspects.concat(relies);
  const uniqueSuspects = Array.from(new Set(suspects));
  const wards = await checkSuspects(web3, chainLog, address, uniqueSuspects);
  const allWards = wards.filter(w => w != address);
  return allWards;
}

const getCustodians = async (env, web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  if (who !== address) {
    console.log(`\nstarting check for ${ who } (${ address })`);
  } else {
    console.log(`\nstarting check for address ${ address }...`);
  }
  const owner = await getOwner(web3, chainLog, address);
  const authority = await getAuthority(web3, chainLog, address);
  const wards = await getWards(env, web3, chainLog, address);
  return { owner, authority, wards };
}

const cacheLogs = async (web3, chainLog, addresses) => {
  const newAddresses = addresses.filter(a => !scannedAddresses.includes(a));
  if (newAddresses.length > 1) {
    console.log();
    allLogs.push(...await getLogs(web3, chainLog, newAddresses));
    scannedAddresses.push(...newAddresses);
  }
}

const getGraph = async (env, web3, chainLog, address) => {
  const edges = [];
  const vertices = { all: [], current: [], new: [ address ]};
  while(vertices.new.length) {
    vertices.current = Array.from(new Set(vertices.new));
    vertices.all.push(...vertices.current);
    vertices.new = [];
    await cacheLogs(web3, chainLog, vertices.current);
    for (const dst of vertices.current) {
      const custodians = await getCustodians(env, web3, chainLog, dst);
      if (custodians.owner) {
        edges.push({ dst, src: custodians.owner, lbl: 'owner' });
        vertices.new.push(custodians.owner);
      }
      if (custodians.authority) {
        edges.push({ dst, src: custodians.authority, lbl: 'authority' });
        vertices.new.push(custodians.authority);
      }
      for (const ward of custodians.wards) {
        edges.push({ dst, src: ward, lbl: 'ward' });
        vertices.new.push(ward);
      }
    }
    vertices.new = vertices.new.filter(vertex =>
      !vertices.all.includes(vertex)
    );
  }
  return edges;
}

const getOracleAddresses = async (web3, chainLog) => {
  console.log('getting oracle addresses...\n\n');
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
  console.log(`found ${ oracles.length } oracle addresses`);
  return oracles;
}

const writeResult = (next, type) => {
  const dir = type === 'full' ? 'log' : type;
  let prev;
  try {
    prev = fs.readFileSync(`${ dir }/latest.txt`, 'utf8');
  } catch (err) {
    prev = '';
  }
  console.log();
  if (next === prev) {
    console.log(next);
    console.log('no changes since last lookup');
  } else {
    fs.writeFileSync(`${ dir }/${ new Date().getTime() }.txt`, next);
    fs.writeFileSync(`${ dir }/latest.txt`, next);
    console.log(next);
    console.log('changes detected; created new file.');
    console.log('calculating diff, press Ctrl+C to skip');
    const diff = Diff.diffChars(prev, next);
    diff.forEach(part => {
      const text = part.added
            ? chalk.green(part.value)
            : part.removed
            ? chalk.red(part.value)
            : chalk.grey(part.value);
      process.stdout.write(text);
    });
    console.log('\nchanges detected since last lookup');
  }
}

const drawSubTree = (chainLog, graph, parents, root) => {
  const subGraph = graph.filter(edge => edge.dst === root);
  const subTree = {};
  for (const edge of subGraph) {
    if (parents.includes(edge.src)) continue;
    const who = getWho(chainLog, edge.src);
    const card = `${ edge.lbl }: ${ who }`;
    subTree[card] = drawSubTree(chainLog, graph, [...parents, root ], edge.src);
  }
  return subTree;
}

const drawTree = (chainLog, graph, root) => {
  const who = getWho(chainLog, root);
  const subTree = drawSubTree(chainLog, graph, [], root);
  const tree = who + '\n' + treeify.asTree(subTree);
  return tree;
}

const readGraph = who => {
  return JSON.parse(fs.readFileSync(`debug/${ who }.json`, 'utf8'));
}

const writeGraph = (chainLog, name, graph) => {
  fs.writeFileSync(`debug/${ name }.json`, JSON.stringify(graph));
  const namedGraph = graph.map(edge => {
    return {
      dst: getWho(chainLog, edge.dst),
      src: getWho(chainLog, edge.src),
      lbl: edge.lbl
    };
  });
  fs.writeFileSync(
    `debug/${ name }-named.json`,
    JSON.stringify(namedGraph, null, 4)
  );
}

const fullMode = async (env, args, web3, chainLog) => {
  console.log('performing full system lookup...');
  const vatAddress = getKey(chainLog, 'MCD_VAT');
  let graph;
  if (args.debug === 'read') {
    graph = readGraph('MCD_VAT');
  } else {
    graph = await getGraph(env, web3, chainLog, vatAddress);
    if (args.debug === 'write') {
      writeGraph(chainLog, 'MCD_VAT', graph);
    }
  }
  const tree = drawTree(chainLog, graph, vatAddress);
  writeResult(tree, 'full');
}

const oraclesMode = async (env, args, web3, chainLog) => {
  const addresses = await getOracleAddresses(web3, chainLog);
  let trees = '';
  if (args.debug !== 'read') {
    await cacheLogs(web3, chainLog, addresses);
  }
  for (const address of addresses) {
    let graph;
    const who = getWho(chainLog, address);
    if (args.debug === 'read') {
      try {
        graph = readGraph(who);
      } catch (err) {
        continue;
      }
    } else {
      graph = await getGraph(env, web3, chainLog, address);
      if (args.debug === 'write') {
        writeGraph(chainLog, who, graph);
      }
    }
    const tree = drawTree(chainLog, graph, address);
    trees += tree + '\n';
  }
  writeResult(trees, 'oracles');
}

const contractMode = async (env, args, web3, chainLog, contract) => {
  let address;
  if (isAddress(contract)) {
    address = web3.utils.toChecksumAddress(contract);
  } else {
    address = getKey(chainLog, contract);
    if (!address) {
      console.log(chainLog);
      console.log(`'${ contract }' isn't an address nor does it exist in the`
                  + ` chainlog.`);
      process.exit();
    }
  }
  const who = getWho(chainLog, address);
  let graph;
  if (args.debug === 'read') {
    graph = readGraph(who);
  } else {
    graph = await getGraph(env, web3, chainLog, address);
    if (args.debug === 'write') {
      writeGraph(chainLog, who, graph);
    }
  }
  const tree = drawTree(chainLog, graph, address);
  console.log();
  console.log(tree);
}

const parseArgs = () => {
  const parser = new ArgumentParser({
    description: 'check permissions for DSS'
  });
  parser.add_argument('--mode', '-m', {
    help: 'mode: full, oracles, contract',
  });
  parser.add_argument('contract', {
    help: 'contract to inspect',
    nargs: '?',
  });
  parser.add_argument('--debug', '-d', {
    help: 'debug mode: write, read',
  });
  const args = parser.parse_args();
  if (!args.contract && !args.mode) {
    args.mode = 'full';
  }
  if (!['full', 'oracles'].includes(args.mode) && !args.contract) {
    parser.print_help();
    process.exit();
  }
  return args;
}

const ward = async () => {
  const env = getEnv();
  const args = parseArgs();
  const web3 = new Web3(env.ETH_RPC_URL);
  const chainLog = await getChainLog(args, web3);
  if (args.mode === 'full') {
    await fullMode(env, args, web3, chainLog);
  } else if (args.mode === 'oracles') {
    await oraclesMode(env, args, web3, chainLog);
  } else {
    await contractMode(env, args, web3, chainLog, args.contract);
  }
}

ward();
