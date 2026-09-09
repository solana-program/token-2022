import * as c from 'codama';

export default {
    idl: 'idl.json',
    before: [
        {
            // The `extensions` field of the `mint` and `token` accounts is a TLV region that may
            // be followed by unused space of any size. Codama cannot express "stop at the first
            // `Uninitialized` header", so the inner extension array is swapped for a hand-written
            // codec (see `clients/js/src/hooked/extensions.ts`) that mirrors the program's TLV
            // walk. The surrounding `remainderOption` and `hiddenPrefix` (account type byte)
            // wrappers stay generated.
            from: 'codama#bottomUpTransformerVisitor',
            args: [
                [
                    {
                        select: '[accountNode].[structFieldTypeNode]extensions.[hiddenPrefixTypeNode].[arrayTypeNode]',
                        transform: () => c.definedTypeLinkNode('extensions'),
                    },
                ],
                {
                    // Only walk down to the account fields: some enum variants in the IDL wrap
                    // their struct in a `sizePrefixTypeNode`, which the transformer's node
                    // constructors reject.
                    keys: [
                        'rootNode',
                        'programNode',
                        'accountNode',
                        'structTypeNode',
                        'structFieldTypeNode',
                        'remainderOptionTypeNode',
                        'hiddenPrefixTypeNode',
                        'arrayTypeNode',
                    ],
                },
            ],
        },
    ],
    scripts: {
        js: {
            from: '@codama/renderers-js',
            args: [
                'clients/js',
                {
                    kitImportStrategy: 'rootOnly',
                    linkOverrides: {
                        definedTypes: { extensions: 'hooked' },
                    },
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
