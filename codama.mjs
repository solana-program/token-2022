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
                },
            ],
        },
    },
};
