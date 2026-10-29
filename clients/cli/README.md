# SPL Token program command-line utility

A basic command-line for creating and using SPL Tokens.  See the
[Solana Program Docs](https://www.solana-program.com/docs/token) for more info.

## Build

To build the CLI locally, simply run:

```sh
cargo build
```

## Testing

The tests require locally built Token-2022 and ElGamal registry programs. To build
them, run the following commands from the root directory of this repository:

```sh
cargo build-sbf --manifest-path program/Cargo.toml
cargo build-sbf --manifest-path confidential/elgamal-registry/Cargo.toml
```

After that, you can run the tests as any other Rust project:

```sh
cargo test
```
