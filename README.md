# dss-ward

Show authorizations of DSS contracts.

![Screenshot from 2021-04-22 10-05-02](https://user-images.githubusercontent.com/16065447/115738016-45492780-a352-11eb-82cd-5bdfc2f483f4.png)

This script checks:

* owner
* authority
* wards: deployer, logNote relies and event-emitting relies
* buds: logNote kisses and event-emitting kisses

It can be used to check the authorities over a single contract by specifying its
chainlog name or address, or it can also be used to check all the authorities in
the system by starting from the Vat and hierarchically finding all the addresses
that have authority over it.

Its outputs are a `tree`-style authorization hierarchy, and an interactive d3.js
graph.

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

This is the simplest and fastest way this script can be used. It obtains all
the addresses that have a certain authority over a contract you specify. Note,
however, that this will not obtain the authorities that this specific contract
has over other contracts in the system. In order to obtain these, check
[get permissions of a contract](https://github.com/makerdao/dss-ward#get-permissions-of-a-contract)

In order to get the authorities over a specific contract, run

```
node src/ward.js MCD_SPOT
```

This will work with any contract that's in the chainlog. Otherwise, you can run

```
node src/ward.js 0xDa0FaB05039809e63C5D068c897c3e602fA97457
```

in order to get the authorities over an arbitrary address.

### run checks for the VAT

In order to check the authorities in the VAT, run

```
node src/ward.js MCD_VAT
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

### run checks for the whole system

```
node src/ward.js --mode full
```

This command will run checks for the vat, the oracles, and any remaining
addresses in the chainlog. Its result can be visualized as a graph. See
[graph visualization](https://github.com/makerdao/dss-ward#graph-visualization).

### get permissions of a contract

The permissions of a contract are all the contracts where it is an
authority. In other words, getting the permissions of a contract is the reverse
operation from getting its authorities.

```
node src/ward.js --mode permissions MCD_SPOT
```

### graph visualization

![dss-graph](https://user-images.githubusercontent.com/16065447/115738639-d7513000-a352-11eb-8cff-507021629945.gif)

In order to visualize the whole system as a graph, first run a
[full check](https://github.com/makerdao/dss-ward#run-checks-for-the-whole-system)).
Then run

```
node src/server.js
```

And finally open `src/graph.html` in a browser.
