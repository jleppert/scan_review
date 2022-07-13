#!/bin/bash

SCRIPT_DIR=$( cd ${0%/*} && pwd -P )

/usr/bin/env node --experimental-wasm-bigint $SCRIPT_DIR/index.js
