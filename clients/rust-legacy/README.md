## SPL Token Client

All of the end-to-end tests for spl-token-2022 exist in this package.

### Requirements

These tests require other built on-chain programs, including:

* spl-instruction-padding
* spl-transfer-hook-example
* spl-transfer-hook-example-downgrade
* spl-transfer-hook-example-fail
* spl-transfer-hook-example-success
* spl-transfer-hook-example-swap
* spl-transfer-hook-example-swap-with-fee

Built versions of these programs exist in `tests/fixtures`, and may be
regenerated from the following places in this repo:

* clients/rust-legacy/transfer-hook-test-programs/downgrade
* clients/rust-legacy/transfer-hook-test-programs/fail
* clients/rust-legacy/transfer-hook-test-programs/success
* clients/rust-legacy/transfer-hook-test-programs/swap
* clients/rust-legacy/transfer-hook-test-programs/swap-with-fee

Outside of this repo, other built programs are required:

* spl-instruction-padding
* spl-transfer-hook-example
