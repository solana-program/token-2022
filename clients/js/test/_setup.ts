import { getCreateAccountInstruction } from '@solana-program/system';
import {
  Address,
  Commitment,
  CompilableTransactionMessage,
  IInstruction,
  Rpc,
  RpcSubscriptions,
  SolanaRpcApi,
  SolanaRpcSubscriptionsApi,
  TransactionMessageWithBlockhashLifetime,
  TransactionSigner,
  airdropFactory,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getSignatureFromTransaction,
  lamports,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit';
import {
  ExtensionArgs,
  TOKEN_2022_PROGRAM_ADDRESS,
  getInitializeAccountInstruction,
  getPreInitializeInstructionsForMintExtensions,
  getInitializeMintInstruction,
  getMintSize,
  getMintToInstruction,
  getTokenSize,
  getPostInitializeInstructionsForMintExtensions,
  getPostInitializeInstructionsForTokenExtensions,
  Extension,
} from '../src';

type Client = {
  rpc: Rpc<SolanaRpcApi>;
  rpcSubscriptions: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
};

export const createDefaultSolanaClient = (): Client => {
  const rpc = createSolanaRpc('http://127.0.0.1:8899');
  const rpcSubscriptions = createSolanaRpcSubscriptions('ws://127.0.0.1:8900');
  return { rpc, rpcSubscriptions };
};

export const generateKeyPairSignerWithSol = async (
  client: Client,
  putativeLamports: bigint = 1_000_000_000n
) => {
  const signer = await generateKeyPairSigner();
  await airdropFactory(client)({
    recipientAddress: signer.address,
    lamports: lamports(putativeLamports),
    commitment: 'confirmed',
  });
  return signer;
};

export const createDefaultTransaction = async (
  client: Client,
  feePayer: TransactionSigner
) => {
  const { value: latestBlockhash } = await client.rpc
    .getLatestBlockhash()
    .send();
  return pipe(
    createTransactionMessage({ version: 0 }),
    (tx) => setTransactionMessageFeePayerSigner(feePayer, tx),
    (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx)
  );
};

export const signAndSendTransaction = async (
  client: Client,
  transactionMessage: CompilableTransactionMessage &
    TransactionMessageWithBlockhashLifetime,
  commitment: Commitment = 'confirmed'
) => {
  const signedTransaction =
    await signTransactionMessageWithSigners(transactionMessage);
  const signature = getSignatureFromTransaction(signedTransaction);
  await sendAndConfirmTransactionFactory(client)(signedTransaction, {
    commitment,
  });
  return signature;
};

export const sendAndConfirmInstructions = async (
  client: Client,
  payer: TransactionSigner,
  instructions: IInstruction[]
) => {
  const signature = await pipe(
    await createDefaultTransaction(client, payer),
    (tx) => appendTransactionMessageInstructions(instructions, tx),
    (tx) => signAndSendTransaction(client, tx)
  );
  return signature;
};

export const getCreateMintInstructions = async (input: {
  authority: Address;
  client: Client;
  decimals?: number;
  extensions?: ExtensionArgs[];
  freezeAuthority?: Address;
  mint: TransactionSigner;
  payer: TransactionSigner;
  programAddress?: Address;
}) => {
  const space = getMintSize(input.extensions);
  const postInitializeExtensions: Extension['__kind'][] = [
    'TokenMetadata',
    'TokenGroup',
    'TokenGroupMember',
  ];
  const spaceWithoutPostInitializeExtensions = input.extensions
    ? getMintSize(
        input.extensions.filter(
          (e) => !postInitializeExtensions.includes(e.__kind)
        )
      )
    : space;
  const rent = await input.client.rpc
    .getMinimumBalanceForRentExemption(BigInt(space))
    .send();
  return [
    getCreateAccountInstruction({
      payer: input.payer,
      newAccount: input.mint,
      lamports: rent,
      space: spaceWithoutPostInitializeExtensions,
      programAddress: input.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS,
    }),
    getInitializeMintInstruction({
      mint: input.mint.address,
      decimals: input.decimals ?? 0,
      freezeAuthority: input.freezeAuthority,
      mintAuthority: input.authority,
    }),
  ];
};

export const getCreateTokenInstructions = async (input: {
  client: Client;
  extensions?: ExtensionArgs[];
  mint: Address;
  owner: Address;
  payer: TransactionSigner;
  programAddress?: Address;
  token: TransactionSigner;
}) => {
  const space = getTokenSize(input.extensions);
  const rent = await input.client.rpc
    .getMinimumBalanceForRentExemption(BigInt(space))
    .send();
  return [
    getCreateAccountInstruction({
      payer: input.payer,
      newAccount: input.token,
      lamports: rent,
      space,
      programAddress: input.programAddress ?? TOKEN_2022_PROGRAM_ADDRESS,
    }),
    getInitializeAccountInstruction({
      account: input.token.address,
      mint: input.mint,
      owner: input.owner,
    }),
  ];
};

export const createMint = async (
  input: Omit<
    Parameters<typeof getCreateMintInstructions>[0],
    'authority' | 'mint'
  > & {
    authority: TransactionSigner;
    mint?: TransactionSigner;
  }
): Promise<Address> => {
  const mint = input.mint ?? (await generateKeyPairSigner());
  const [createAccount, initMint] = await getCreateMintInstructions({
    ...input,
    authority: input.authority.address,
    mint,
  });
  await sendAndConfirmInstructions(input.client, input.payer, [
    createAccount,
    ...getPreInitializeInstructionsForMintExtensions(
      mint.address,
      input.extensions ?? []
    ),
    initMint,
    ...getPostInitializeInstructionsForMintExtensions(
      mint.address,
      input.authority,
      input.extensions ?? []
    ),
  ]);
  return mint.address;
};

export const createToken = async (
  input: Omit<
    Parameters<typeof getCreateTokenInstructions>[0],
    'token' | 'owner'
  > & { owner: TransactionSigner }
): Promise<Address> => {
  const token = await generateKeyPairSigner();
  const [createAccount, initToken] = await getCreateTokenInstructions({
    ...input,
    owner: input.owner.address,
    token,
  });
  await sendAndConfirmInstructions(input.client, input.payer, [
    createAccount,
    initToken,
    ...getPostInitializeInstructionsForTokenExtensions(
      token.address,
      input.owner,
      input.extensions ?? []
    ),
  ]);
  return token.address;
};

export const createTokenWithAmount = async (
  input: Omit<
    Parameters<typeof getCreateTokenInstructions>[0],
    'token' | 'owner'
  > & {
    amount: number | bigint;
    mintAuthority: TransactionSigner;
    owner: TransactionSigner;
  }
): Promise<Address> => {
  const token = await generateKeyPairSigner();
  const [createAccount, initToken] = await getCreateTokenInstructions({
    ...input,
    owner: input.owner.address,
    token,
  });
  await sendAndConfirmInstructions(input.client, input.payer, [
    createAccount,
    initToken,
    ...getPostInitializeInstructionsForTokenExtensions(
      token.address,
      input.owner,
      input.extensions ?? []
    ),
    getMintToInstruction({
      mint: input.mint,
      token: token.address,
      mintAuthority: input.mintAuthority,
      amount: input.amount,
    }),
  ]);
  return token.address;
};
