export default {
    idl: 'idl.json',
    before: [],
    scripts: {
        js: {
            from: '@codama/renderers-js',
            args: [
                'clients/js',
                {
                    kitImportStrategy: 'rootOnly',
                    // The program was historically named `token-2022` in the IDL, which gave the
                    // generated `TOKEN_2022_*` identifiers. Codama normalises names to camelCase
                    // (`token2022`), so the public identifiers are pinned here to keep the API stable.
                    nameTransformers: {
                        programAddressConstant: (name, { snakeCase }) =>
                            `${snakeCase(name === 'token2022' ? 'token_2022' : name).toUpperCase()}_PROGRAM_ADDRESS`,
                        programErrorConstantPrefix: (name, { snakeCase }) =>
                            `${snakeCase(name === 'token2022' ? 'token_2022' : name).toUpperCase()}_ERROR__`,
                    },
                    syncPackageJson: true,
                    prettierOptions: {
                        arrowParens: 'avoid',
                        printWidth: 120,
                        singleQuote: true,
                        tabWidth: 4,
                        trailingComma: 'all',
                    },
                },
            ],
        },
    },
};
