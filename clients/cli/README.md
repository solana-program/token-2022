# SPL Token program command-line utility

A basic command-line for creating and using SPL Tokens.  See the
[Solana Program Docs](https://www.solana-program.com/docs/token) for more info.

## Build

To build the CLI locally, simply run:

```sh
cargo build
```

## Testing

The tests require a locally built program for Token-2022. To build it, run the
following command from the root directory of this repository:

```sh
cargo build-sbf --manifest-path program/Cargo.toml
```

After that, you can run the tests as any other Rust project:

```sh
cargo test
```
