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
