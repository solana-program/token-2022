const oxfmt = require('oxfmt');
const solanaFmt = require('@solana-config/oxc/oxfmt');

module.exports = oxfmt.defineConfig({
    ...solanaFmt,
    ignorePatterns: ['**/dist/**', 'src/generated/**', 'test-ledger/**'],
});
