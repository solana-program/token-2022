import { extension, fetchMint, token2022Program } from '@solana-program/token-2022';
import { createClient, generateKeyPairSigner, lamports, some } from '@solana/kit';
import { solanaLocalRpc } from '@solana/kit-plugin-rpc';
import { airdropSigner, generatedSigner } from '@solana/kit-plugin-signer';

const client = await createClient()
    .use(generatedSigner())
    .use(solanaLocalRpc())
    .use(airdropSigner(lamports(1_000_000_000n)))
    .use(token2022Program());
const mint = await generateKeyPairSigner();

await client.token2022.instructions
    .createMint({
        newMint: mint,
        decimals: 9,
        mintAuthority: client.identity,
        extensions: [
            // Store the metadata on the mint itself.
            extension('MetadataPointer', {
                authority: some(client.identity.address),
                metadataAddress: some(mint.address),
            }),
            extension('TokenMetadata', {
                updateAuthority: some(client.identity.address),
                mint: mint.address,
                name: 'My Token',
                symbol: 'MYT',
                uri: 'https://example.com/my-token.json',
                additionalMetadata: new Map(),
            }),
        ],
    })
    .sendTransaction();

const mintAccount = await fetchMint(client.rpc, mint.address);
console.log('Mint:', mint.address);
console.dir(mintAccount.data, { depth: null });
