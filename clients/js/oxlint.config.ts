const oxlint = require('oxlint');
const solanaConfig = require('@solana-config/oxc/oxlint');

module.exports = oxlint.defineConfig({
    extends: [solanaConfig],
    ignorePatterns: ['**/dist/**', 'src/generated/**', 'test-ledger/**'],
    options: { typeAware: true },
    rules: { 'sort-keys': 'off' },
});
