#!/usr/bin/env zx
import 'zx/globals';
import { createFromRoot } from 'kinobi';
import { renderVisitor as renderJavaScriptVisitor } from '@kinobi-so/renderers-js';
// import { renderVisitor as renderRustVisitor } from "@kinobi-so/renderers-rust";
import { workingDirectory } from './utils.mjs';

// Instanciate Kinobi.
const kinobi = createFromRoot(
  require(path.join(workingDirectory, 'program', 'idl.json'))
);

// Render JavaScript.
const jsClient = path.join(__dirname, '..', 'clients', 'js');
kinobi.accept(
  renderJavaScriptVisitor(path.join(jsClient, 'src', 'generated'), {
    prettier: require(path.join(jsClient, '.prettierrc.json')),
  })
);

// Render Rust.
// const rustClient = path.join(__dirname, "..", "clients", "rust");
// kinobi.accept(
//   renderRustVisitor(path.join(rustClient, "src", "generated"), {
//     formatCode: true,
//     crateFolder: rustClient,
//   })
// );
