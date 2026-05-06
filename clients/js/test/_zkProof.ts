import { address, type Instruction } from '@solana/kit';
import type { PubkeyValidityProofData } from '@solana/zk-sdk/node';

export const ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS = address('ZkE1Gama1Proof11111111111111111111111111111');

const VERIFY_PUBKEY_VALIDITY_DISCRIMINATOR = 4;

export const getVerifyPubkeyValidityInstruction = (
    proofData: Pick<PubkeyValidityProofData, 'toBytes'>,
): Instruction<typeof ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS> => {
    const proofDataBytes = proofData.toBytes();
    const data = new Uint8Array(1 + proofDataBytes.length);

    data[0] = VERIFY_PUBKEY_VALIDITY_DISCRIMINATOR;
    data.set(proofDataBytes, 1);

    return Object.freeze({
        accounts: [],
        data,
        programAddress: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
    } as Instruction<typeof ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS>);
};
