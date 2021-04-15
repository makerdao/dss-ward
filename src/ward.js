const { ArgumentParser } = require('argparse');
const Web3 = require('web3');
const settings = require('../settings.js');
const fs = require('fs');
const fetch = require('node-fetch');
const treeify = require('treeify');
const Diff = require('diff');
const chalk = require('chalk');
const { createHash } = require('crypto');

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
  if (cached(args).includes('chainlog')) {
    return JSON.parse(fs.readFileSync('cached/chainLog.json', 'utf8'));
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
  fs.writeFileSync('cached/chainLog.json', JSON.stringify(chainLog));
  return chainLog;
}

const getKey = (object, value) => {
  return Object.keys(object).find(key => object[key] === value);
}

const getWho = (chainLog, address) => {
  return chainLog[address] || address;
}

const getTopics = web3 => {
  const logNoteRely = getSig(web3, 'rely(address)');
  const logNoteKiss = getSig(web3, 'kiss(address)');
  const logNoteKisses = getSig(web3, 'kiss(address[])');
  const eventRely = web3.utils.sha3('Rely(address)');
  const eventKiss = web3.utils.sha3('Kiss(address)');
  const topics = [[
    logNoteRely,
    logNoteKiss,
    logNoteKisses,
    eventRely,
    eventKiss
  ]];
  return topics;
}

const getLogs = async (args, web3, chainLog, addresses) => {
  let digest;
  const hash = createHash('sha256');
  hash.update(addresses.join());
  digest = hash.digest('hex');
  if (cached(args).includes('logs')) {
    return JSON.parse(fs.readFileSync(`cached/logs-${ digest }.json`, 'utf8'));
  }
  const who = addresses.length === 1
        ? await getWho(chainLog, addresses[0])
        : `${ addresses.length } addresses`;
  let logs = [];
  const topics = getTopics(web3);
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
    process.stdout.write(`getting logNote and event relies and kisses for `
                         + `${ who }... ${ progress.toFixed(1) }%\r`);
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
  process.stdout.write(`getting logNote and event relies and kisses for `
                       + `${ who }... `);
  console.log(`found ${ logs.length } relies in ${ span } seconds`);
  const jsonLogs = JSON.stringify(logs, null, 4);
  fs.writeFileSync(`cached/logs-${ digest }.json`, jsonLogs);
  return logs;
}

const getReliesAndKisses = async (args, web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  const reliesAndKisses = [];
  let logs;
  if (scannedAddresses.includes(address)) {
    logs = allLogs.filter(log => log.address === address);
    console.log(`getting logNote and event relies and kisses for ${ who }... `
                + `found ${ logs.length } cached logs`);
  } else {
    logs = await getLogs(args, web3, chainLog, [ address ]);
    allLogs[address] = logs;
    scannedAddresses.push(address);
  }
  for (const log of logs) {
    const addresses = getAddresses(web3, log);
    reliesAndKisses.push(...addresses);
  }
  const uniqueReliesAndKisses = Array.from(new Set(reliesAndKisses));
  return uniqueReliesAndKisses;
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
  const uniqueDeployers = Array.from(new Set(deployers));
  console.log(uniqueDeployers.map(deployer => getWho(chainLog, deployer)));
  return uniqueDeployers;
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

const getWards = async (env, args, web3, chainLog, address) => {
  let suspects = [];
  const deployers = await getDeployers(env, web3, chainLog, address);
  suspects = suspects.concat(deployers);
  const relies = await getReliesAndKisses(args, web3, chainLog, address);
  suspects = suspects.concat(relies);
  const uniqueSuspects = Array.from(new Set(suspects));
  const wards = await checkSuspects(web3, chainLog, address, uniqueSuspects);
  const allWards = wards.filter(w => w != address);
  return allWards;
}

const getBuds = async (args, web3, chainLog, address) => {
  const buds = [];
  const who = getWho(chainLog, address);
  const kisses = await getReliesAndKisses(args, web3, chainLog, address);
  const abi = getJson('./lib/univ2-lp-oracle/out/UNIV2LPOracle.abi');
  const contract = new web3.eth.Contract(abi, address);
  let hasBuds = true;
  let count = 1;
  const start = new Date();
  for (const kiss of kisses) {
    const progress = Math.floor(100 * count / kisses.length);
    count ++;
    process.stdout.write(`checking buds for ${ who }... ${ progress }%\r`);
    try {
      const bud = await contract.methods.bud(kiss).call();
      if (bud != 0) {
        buds.push(kiss);
      }
    } catch (err) {
      console.log(`checking buds for ${ who }... no buds`);
      hasBuds = false;
      break;
    }
  }
  const end = new Date();
  const span = Math.floor((end - start) / 1000);
  if (hasBuds) {
    console.log(`checking buds for ${ who }... found ${ kisses.length }`
                + ` wards in ${ span } seconds`);
  }
  return buds;
}

const getAuthorities = async (env, args, web3, chainLog, address) => {
  const who = getWho(chainLog, address);
  if (who !== address) {
    console.log(`\nstarting check for ${ who } (${ address })`);
  } else {
    console.log(`\nstarting check for address ${ address }...`);
  }
  const owner = await getOwner(web3, chainLog, address);
  const authority = await getAuthority(web3, chainLog, address);
  const wards = await getWards(env, args, web3, chainLog, address);
  const buds = await getBuds(args, web3, chainLog, address);
  return { owner, authority, wards, buds };
}

const cacheLogs = async (args, web3, chainLog, addresses) => {
  const newAddresses = addresses.filter(a => !scannedAddresses.includes(a));
  if (newAddresses.length > 1) {
    console.log();
    allLogs.push(...await getLogs(args, web3, chainLog, newAddresses));
    scannedAddresses.push(...newAddresses);
  }
}

const getGraph = async (env, args, web3, chainLog, address) => {
  const edges = [];
  const vertices = { all: [], current: [], new: [ address ]};
  while(vertices.new.length) {
    vertices.current = Array.from(new Set(vertices.new));
    vertices.all.push(...vertices.current);
    vertices.new = [];
    await cacheLogs(args, web3, chainLog, vertices.current);
    for (const dst of vertices.current) {
      const authorities = await getAuthorities(env, args, web3, chainLog, dst);
      if (authorities.owner) {
        edges.push({ dst, src: authorities.owner, lbl: 'owner' });
        vertices.new.push(authorities.owner);
      }
      if (authorities.authority) {
        edges.push({ dst, src: authorities.authority, lbl: 'authority' });
        vertices.new.push(authorities.authority);
      }
      for (const ward of authorities.wards) {
        edges.push({ dst, src: ward, lbl: 'ward' });
        vertices.new.push(ward);
      }
      for (const bud of authorities.buds) {
        edges.push({ dst, src: bud, lbl: 'bud' });
        vertices.new.push(bud);
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

const drawSubTree = (chainLog, graph, parents, root, level, depth) => {
  if (depth && level == depth) return {};
  const subGraph = graph.filter(edge => edge.dst === root);
  const subTree = {};
  for (const edge of subGraph) {
    if (parents.includes(edge.src)) continue;
    const who = getWho(chainLog, edge.src);
    const card = `${ edge.lbl }: ${ who }`;
    subTree[card] = drawSubTree(
      chainLog,
      graph,
      [ ...parents, root ],
      edge.src,
      level + 1,
      depth
    );
  }
  return subTree;
}

const drawReverseSubTree = (chainLog, graph, parents, root, level, depth) => {
  if (depth && level == depth) return {};
  const subGraph = graph.filter(edge => edge.src === root);
  const subTree = {};
  for (const edge of subGraph) {
    if (parents.includes(edge.dst)) continue;
    const who = getWho(chainLog, edge.dst);
    const card = `${ edge.lbl } of ${ who }`;
    subTree[card] = drawReverseSubTree(
      chainLog,
      graph,
      [...parents, root],
      edge.dst,
      level + 1,
      depth
    );
  }
  return subTree;
}

const drawTree = (chainLog, graph, depth, root) => {
  const who = getWho(chainLog, root);
  const subTree = drawSubTree(chainLog, graph, [], root, 0, depth);
  const tree = who + '\n' + treeify.asTree(subTree);
  return tree;
}

const drawPermissions = (chainLog, graph, depth, root) => {
  const who = getWho(chainLog, root);
  const subTree = drawReverseSubTree(chainLog, graph, [], root, 0, depth);
  const tree = who + '\n' + treeify.asTree(subTree);
  return tree;
}

const readGraph = who => {
  return JSON.parse(fs.readFileSync(`cached/${ who }.json`, 'utf8'));
}

const writeGraph = (chainLog, name, graph) => {
  fs.writeFileSync(`cached/${ name }.json`, JSON.stringify(graph));
  const namedGraph = graph.map(edge => {
    return {
      target: getWho(chainLog, edge.dst),
      source: getWho(chainLog, edge.src),
      label: edge.lbl
    };
  });
  const edges = namedGraph.map(edge => edge.source);
  const destinations = namedGraph.map(edge => edge.target);
  edges.push(...destinations);
  const uniqueEdges = Array.from(new Set(edges));
  const objectEdges = uniqueEdges.map(edge => { return {id: edge}; });
  const output = {links: namedGraph, nodes: objectEdges};
  fs.writeFileSync(
    `graph/${ name }.json`,
    JSON.stringify(output, null, 4)
  );
}

const fullMode = async (env, args, web3, chainLog) => {
  console.log('performing full system lookup...');
  const vatAddress = getKey(chainLog, 'MCD_VAT');
  let graph;
  if (cached(args).includes('graph')) {
    graph = readGraph('MCD_VAT');
  } else {
    graph = await getGraph(env, args, web3, chainLog, vatAddress);
    writeGraph(chainLog, 'MCD_VAT', graph);
  }
  const tree = drawTree(chainLog, graph, args.level, vatAddress);
  writeResult(tree, 'full');
}

const mergeGraphs = (a, b) => {
  for (const edge of a) {
    if (!b.find(e => e.src === edge.src
               && e.dst === edge.dst
               && e.lbl === edge.lbl)
       ) {
      b.push(edge);
    }
  }
  return b;
}

const getOracleGraph = async (env, args, web3, chainLog, addresses) => {
  if (cached(args).includes('graph')) {
    await cacheLogs(args, web3, chainLog, addresses);
  }
  let graph = [];
  for (const address of addresses) {
    const who = getWho(chainLog, address);
    if (cached(args).includes('graph')) {
      try {
        const oracleGraph = readGraph(who);
        graph = mergeGraphs(oracleGraph, graph);
      } catch (err) {
        console.log(err);
        continue;
      }
    } else {
      const oracleGraph = await getGraph(env, args, web3, chainLog, address);
      graph = mergeGraphs(oracleGraph, graph);
      writeGraph(chainLog, who, graph);
    }
  }
  return graph;
}

const oraclesMode = async (env, args, web3, chainLog) => {
  let trees = '';
  const addresses = await getOracleAddresses(web3, chainLog);
  const graph = await getOracleGraph(env, args, web3, chainLog, addresses);
  for (const address of addresses) {
    const tree = drawTree(chainLog, graph, args.level, address);
    trees += tree + '\n';
  }
  writeResult(trees, 'oracles');
}

const parseAddress = (web3, chainLog, contract) => {
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
  return address;
}

const permissionsMode = async (env, args, web3, chainLog, contract) => {
  const address = parseAddress(web3, chainLog, contract);
  const who = getWho(chainLog, address);
  console.log(`performing permissions lookup for ${ who }...`);
  const vatAddress = getKey(chainLog, 'MCD_VAT');
  let graph = [];
  if (cached(args).includes('graph')) {
    const vatGraph = readGraph('MCD_VAT');
    const oracleGraph = readGraph('oracles');
    graph = mergeGraphs(graph, oracleGraph);
  } else {
    const vatGraph = await getGraph(env, args, web3, chainLog, vatAddress);
    const oracles = await getOracleAddresses(web3, chainLog);
    const oracleGraph = await getOracleGraph(env, args, web3, chainLog, oracles);
    graph = mergeGraphs(vatGraph, oracleGraph);
    writeGraph(chainLog, 'MCD_VAT', vatGraph);
    writeGraph(chainLog, 'oracles', oracleGraph);
  }
  const permissions = drawPermissions(chainLog, graph, args.level, address);
  console.log();
  console.log(permissions);
}

const contractMode = async (env, args, web3, chainLog, contract) => {
  const address = parseAddress(web3, chainLog, contract);
  const who = getWho(chainLog, address);
  let graph;
  if (cached(args).includes('graph')) {
    graph = readGraph(who);
  } else {
    graph = await getGraph(env, args, web3, chainLog, address);
      writeGraph(chainLog, who, graph);
  }
  const tree = drawTree(chainLog, graph, args.level, address);
  console.log();
  console.log(tree);
}

const cached = args => {
  return args.cached ? args.cached : [];
}

const parseArgs = () => {
  const parser = new ArgumentParser({
    description: 'check permissions for DSS'
  });
  parser.add_argument('--mode', '-m', {
    help: 'mode: full, oracles, authorities, permissions',
  });
  parser.add_argument('contract', {
    help: 'contract to inspect',
    nargs: '?',
  });
  parser.add_argument('--level', '-l', {
    help: 'maximum depth level for trees',
  });
  parser.add_argument('--cached', '-c', {
    help: 'use cached data',
    choices: ['chainlog', 'logs', 'graph'],
    nargs: '*',
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
  } else if (args.mode === 'permissions') {
    await permissionsMode(env, args, web3, chainLog, args.contract);
  } else {
    await contractMode(env, args, web3, chainLog, args.contract);
  }
}

ward();
