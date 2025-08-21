include vars.env

nightly = +$(subst ",,${RUST_TOOLCHAIN_NIGHTLY})
make-path = $(shell echo $1 | sed 's#-#/#')

cargo-nightly-%:
	cargo $(nightly) $*

audit:
	cargo audit \
			--ignore RUSTSEC-2022-0093 \
			--ignore RUSTSEC-2024-0421 \
			--ignore RUSTSEC-2024-0344 \
			--ignore RUSTSEC-2024-0376

spellcheck:
	cargo spellcheck --code 1

clippy-%:
	cargo $(nightly) clippy --manifest-path $(call make-path,$*)/Cargo.toml \
	  --all-targets \
		-- \
		--deny=warnings \
		--deny=clippy::default_trait_access \
		--deny=clippy::arithmetic_side_effects \
		--deny=clippy::manual_let_else \
		--deny=clippy::used_underscore_binding

format-check-%:
	cargo $(nightly) fmt --check --manifest-path $(call make-path $*)/Cargo.toml

powerset-%:
	cargo $(nightly) hack check --feature-powerset --all-targets --manifest-path $(call make-path $*)/Cargo.toml

semver-check-%:
	cargo semver-checks --manifest-path $(call make-path,$*)/Cargo.toml

shellcheck:
	git ls-files -- '*.sh' | xargs shellcheck --color=always --external-sources --shell=bash

sort-check:
	cargo $(nightly) sort --workspace --check

bench-%:
	cargo $(nightly) bench --manifest-path $(call make-path,$*)/Cargo.toml

format-rust:
	cargo $(nightly) fmt --all

publish-%:
	./scripts/publish-rust.sh $(call make-path,$*)

build-sbf-%:
	cargo build-sbf --manifest-path $(call make-path,$*)/Cargo.toml

build-wasm-%:
	cargo build --target wasm32-unknown-unknown --manifest-path $(call make-path,$*) --all-features

build-doc-%:
	RUSTDOCFLAGS="--cfg docsrs -D warnings" cargo $(nightly) doc --all-features --no-deps --manifest-path $(call make-path,$*)/Cargo.toml

test-doc-%:
	cargo $(nightly) test --doc --all-features --manifest-path $(call make-path,$*)/Cargo.toml

test-%:
	SBF_OUT_DIR=./target/deploy cargo $(nightly) test --manifest-path $(call make-path,$*)/Cargo.toml

# Make defaults % to .o if nothing is provided there, and then tries to build it
# as a C project, so we do something a bit hacky, and assume that any target
# starting with "j" is actually for "js".
format-j%:
	cd ./clients/j$* && pnpm install && pnpm format

lint-j%:
	cd ./clients/j$* && pnpm install && pnpm lint

publish-j%:
	./scripts/publish-js.sh clients/j$*

test-j%:
	./scripts/restart-test-validator.sh
	cd ./clients/j$* && pnpm install && pnpm build && pnpm test
	./scripts/stop-test-validator.sh
