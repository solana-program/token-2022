# JavaScript client

A generated JavaScript library for the Token 2022 program.

## Getting started

To build and test your JavaScript client from the root of the repository, you
may use the following command.

```sh
make test-js-clients-js
```

This will start a new local validator, if one is not already running, and run
the tests for your JavaScript client.

## Available client scripts.

Alternatively, you can go into the client directory and run the tests directly.

```sh
# Build your programs and start the validator.
make build-sbf-program
make build-sbf-confidential-elgamal-registry
make restart-test-validator

# Go into the client directory and run the tests.
cd clients/js
pnpm install
pnpm build
pnpm test
```

You may also use the following scripts to lint and/or format your JavaScript client.

```sh
make lint-js-clients-js
make format-check-js-clients-js
```
