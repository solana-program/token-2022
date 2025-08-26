#!/usr/bin/env bash

if lsof -t -i:8899 > /dev/null; then
  echo "Stopping test validator..."
  pkill -f solana-test-validator
  sleep 1
  echo "Test validator terminated."
else
  echo "Test validator is not running."
fi
