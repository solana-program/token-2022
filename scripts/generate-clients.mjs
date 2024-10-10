#!/usr/bin/env zx
import 'zx/globals';
import { createFromRoot } from 'codama';
import { renderVisitor as renderJavaScriptVisitor } from '@codama/renderers-js';
// import { renderVisitor as renderRustVisitor } from "@codama/renderers-rust";
import { workingDirectory } from './utils.mjs';

// Instanciate Codama.
const codama = createFromRoot(
  require(path.join(workingDirectory, 'program', 'idl.json'))
);

// Render JavaScript.
const jsClient = path.join(__dirname, '..', 'clients', 'js');
codama.accept(
  renderJavaScriptVisitor(path.join(jsClient, 'src', 'generated'), {
    prettier: require(path.join(jsClient, '.prettierrc.json')),
  })
);

// Render Rust.
// const rustClient = path.join(__dirname, "..", "clients", "rust");
// codama.accept(
//   renderRustVisitor(path.join(rustClient, "src", "generated"), {
//     formatCode: true,
//     crateFolder: rustClient,
//   })
// );
