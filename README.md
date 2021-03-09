# dss-ward

Check permissions for DSS contracts.

This script checks:

* owner
* authority
* wards
* deployer
* logNote relies
* event-emitting relies

It can be used to check the permissions of a single contract by specifying its
chainlog name or address, or it can also be used to check all the permissions in
the system by starting from the Vat and hierarchically finding all the addresses
that have permissions over it, both directly and indirectly.

## install

```
git clone git@github.com:makerdao/dss-ward.git
cd dss-ward
./install.sh
```

## run

First, source your ethereum environment in order to have the `ETH_RPC_URL` and
`ETHERSCAN_API_KEY` environment variables.

### run checks for a single contract

In order to check the authorizations for a specific contract, run

```
node src/ward.js MCD_SPOT
```

This will work with any contract that's in the chainlog. Otherwise, you can run

```
node src/ward.js 0xDa0FaB05039809e63C5D068c897c3e602fA97457
```
in order to check the authorization of any contract.

### run checks for the full system

In order to check the authorizations of the whole system, run

```
node src/ward.js [full]
```

This will take a while. At the end, it will output all the addresses that have
direct or indirect permissions over the Vat, ordered by closeness level.

### run checks for oracles

In order to check the authorizations for oracles, run

```
node src/ward.js oracles
```

This will get all the PIPs in the chainlog, as well as their medianizers
(either orbs or source) and run the checks against each one of them.

## current permissions of the mainnet deployment

Currently, the permissions of the mainnet deployment look like this:

```
MCD_VAT
├─ MCD_SPOT
├─ MCD_JUG
├─ MCD_POT
├─ MCD_END
├─ MCD_PAUSE_PROXY
│  └─ MCD_PAUSE
│     └─ MCD_ADM
├─ MCD_JOIN_ETH_A
├─ MCD_JOIN_BAT_A
├─ MCD_JOIN_USDC_A
├─ MCD_JOIN_WBTC_A
├─ MCD_JOIN_USDC_B
├─ MCD_JOIN_TUSD_A
├─ MCD_JOIN_KNC_A
├─ MCD_JOIN_ZRX_A
├─ MCD_JOIN_MANA_A
├─ MCD_FLOP
│  └─ MCD_PAUSE_PROXY
│     └─ MCD_PAUSE
│        └─ MCD_ADM
├─ MCD_CAT
│  └─ MCD_PAUSE_PROXY
│     └─ MCD_PAUSE
│        └─ MCD_ADM
├─ MCD_JOIN_USDT_A
├─ MCD_JOIN_PAXUSD_A
├─ MCD_JOIN_COMP_A
├─ MCD_JOIN_LRC_A
├─ MCD_JOIN_LINK_A
├─ MCD_JOIN_ETH_B
├─ MCD_JOIN_BAL_A
├─ MCD_JOIN_YFI_A
├─ MCD_JOIN_GUSD_A
├─ MCD_JOIN_UNI_A
├─ MCD_JOIN_RENBTC_A
├─ MCD_IAM_AUTO_LINE
│  └─ MCD_PAUSE_PROXY
│     └─ MCD_PAUSE
│        └─ MCD_ADM
├─ MCD_JOIN_AAVE_A
├─ MCD_JOIN_UNIV2DAIETH_A
├─ MCD_JOIN_PSM_USDC_A
├─ MCD_JOIN_UNIV2WBTCETH_A
├─ MCD_JOIN_UNIV2USDCETH_A
├─ MCD_JOIN_UNIV2DAIUSDC_A
├─ MCD_JOIN_UNIV2ETHUSDT_A
├─ MCD_JOIN_UNIV2LINKETH_A
├─ MCD_JOIN_UNIV2UNIETH_A
├─ MCD_JOIN_UNIV2WBTCDAI_A
├─ MCD_JOIN_UNIV2AAVEETH_A
├─ MCD_JOIN_UNIV2DAIUSDT_A
├─ MCD_JOIN_RWA001_A
│  └─ MCD_PAUSE_PROXY
│     └─ MCD_PAUSE
│        └─ MCD_ADM
└─ MIP21_LIQUIDATION_ORACLE
   └─ MCD_PAUSE_PROXY
      └─ MCD_PAUSE
         └─ MCD_ADM

```
