# dss-ward

Check authorities over DSS contracts.

This script checks:

* owner
* authority
* wards: deployer, logNote relies and event-emitting relies

It can be used to check the authorities over a single contract by specifying its
chainlog name or address, or it can also be used to check all the authorities in
the system by starting from the Vat and hierarchically finding all the addresses
that have authority over it.

## install

```
git clone git@github.com:makerdao/dss-ward.git
cd dss-ward
./install.sh
```

## run

First, source your ethereum environment in order to have the `ETH_RPC_URL` and
`ETHERSCAN_API_KEY` environment variables.

### get authorities over a single contract

In order to get the authorities over a specific contract, run

```
node src/ward.js MCD_SPOT
```

This will work with any contract that's in the chainlog. Otherwise, you can run

```
node src/ward.js 0xDa0FaB05039809e63C5D068c897c3e602fA97457
```
in order to get the authorities over any contract.

### run checks for the full system

In order to check the authorities in the whole system, run

```
node src/ward.js --mode full
```

This will take a while. At the end, it will output all the  addresses that have
direct or indirect authority over the Vat, ordered hierarchically.

### run checks for oracles

In order to get the authorities over the oracles, run

```
node src/ward.js --mode oracles
```

This will get all the `PIP`s in the chainlog, as well as their medianizers
(either `orb`s or `src`) and get the authorities over each one of them.

### get permissions of a contract

The permissions of a contract are all the contract where it is an
authority. In other words, getting the permissions of a contract is the reverse
operation from getting its authorities.

```
node src/ward.js --mode permissions MCD_SPOT
```
