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

## output example

As of 2021-03-09, the permissions of the mainnet deployment look like this:

![Screenshot from 2021-03-09 11-14-09](https://user-images.githubusercontent.com/16065447/110502652-63700680-80c9-11eb-9624-3c3c0f41af5b.png)
