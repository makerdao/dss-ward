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

In order to check the authorizations for a specific contract, run

```
node src/ward.js MCD_SPOT
```

This will work with any contract that's in the chainlog. Otherwise, you can run

```
node src/ward.js 0xDa0FaB05039809e63C5D068c897c3e602fA97457
```
in order to check the authorization of any contract.

In order to check the authorizations of the whole system, run

```
node src/ward.js
```

This will take a while. At the end, it will output all the addresses that have
direct or indirect permissions over the Vat, ordered by closeness level.
