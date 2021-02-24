#! /bin/bash

npm install
dapp update
cd lib/ds-pause
dapp --use solc:0.6.7 build --extract
cd ../dss-chain-log
dapp --use solc:0.6.7 build --extract
cd ../univ2-lp-oracle
dapp --use solc:0.6.11 build --extract
