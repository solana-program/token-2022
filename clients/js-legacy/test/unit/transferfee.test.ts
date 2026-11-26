import type { Mint } from '../../src';
import {
    calculateFee,
    calculateEpochFee,
    ONE_IN_BASIS_POINTS,
    createInitializeTransferFeeConfigInstruction,
    createWithdrawWithheldTokensFromAccountsInstruction,
    decodeInitializeTransferFeeConfigInstruction,
    decodeWithdrawWithheldTokensFromAccountsInstruction,
    ExtensionType,
    getTransferFeeConfig,
    TOKEN_2022_PROGRAM_ID,
    TransferFeeConfigLayout,
} from '../../src';
import { expect } from 'chai';
import { Keypair, PublicKey } from '@solana/web3.js';

describe('transferFee', () => {
    describe('encoding/decoding `InitializeTransferFeeConfig` instructions', () => {
        it('should encode and decode with both authorities', () => {
            const mint = Keypair.generate().publicKey;
            const transferFeeConfigAuthority = Keypair.generate().publicKey;
            const withdrawWithheldAuthority = Keypair.generate().publicKey;
            const instruction = createInitializeTransferFeeConfigInstruction(
                mint,
                transferFeeConfigAuthority,
                withdrawWithheldAuthority,
                100,
                100n,
            );
            expect(instruction.data.length).to.eql(78);
            const decoded = decodeInitializeTransferFeeConfigInstruction(instruction, TOKEN_2022_PROGRAM_ID);
            expect(decoded.data.transferFeeConfigAuthority).to.eql(transferFeeConfigAuthority);
            expect(decoded.data.withdrawWithheldAuthority).to.eql(withdrawWithheldAuthority);
            expect(decoded.data.transferFeeBasisPoints).to.eql(100);
            expect(decoded.data.maximumFee).to.eql(100n);
        });
        it('should encode and decode with no transfer fee config authority', () => {
            const mint = Keypair.generate().publicKey;
            const withdrawWithheldAuthority = Keypair.generate().publicKey;
            const instruction = createInitializeTransferFeeConfigInstruction(
                mint,
                null,
                withdrawWithheldAuthority,
                100,
                100n,
            );
            expect(instruction.data.length).to.eql(46);
            const decoded = decodeInitializeTransferFeeConfigInstruction(instruction, TOKEN_2022_PROGRAM_ID);
            expect(decoded.data.transferFeeConfigAuthority).to.eql(null);
            expect(decoded.data.withdrawWithheldAuthority).to.eql(withdrawWithheldAuthority);
            expect(decoded.data.transferFeeBasisPoints).to.eql(100);
            expect(decoded.data.maximumFee).to.eql(100n);
        });
        it('should encode and decode with no withdraw withheld authority', () => {
            const mint = Keypair.generate().publicKey;
            const transferFeeConfigAuthority = Keypair.generate().publicKey;
            const instruction = createInitializeTransferFeeConfigInstruction(
                mint,
                transferFeeConfigAuthority,
                null,
                100,
                100n,
            );
            expect(instruction.data.length).to.eql(46);
            const decoded = decodeInitializeTransferFeeConfigInstruction(instruction, TOKEN_2022_PROGRAM_ID);
            expect(decoded.data.transferFeeConfigAuthority).to.eql(transferFeeConfigAuthority);
            expect(decoded.data.withdrawWithheldAuthority).to.eql(null);
            expect(decoded.data.transferFeeBasisPoints).to.eql(100);
            expect(decoded.data.maximumFee).to.eql(100n);
        });
        it('should encode and decode with no authorities', () => {
            const mint = Keypair.generate().publicKey;
            const instruction = createInitializeTransferFeeConfigInstruction(mint, null, null, 100, 100n);
            expect(instruction.data.length).to.eql(14);
            const decoded = decodeInitializeTransferFeeConfigInstruction(instruction, TOKEN_2022_PROGRAM_ID);
            expect(decoded.data.transferFeeConfigAuthority).to.eql(null);
            expect(decoded.data.withdrawWithheldAuthority).to.eql(null);
            expect(decoded.data.transferFeeBasisPoints).to.eql(100);
            expect(decoded.data.maximumFee).to.eql(100n);
        });
    });

    describe('encoding/decoding `WithdrawWithheldTokensFromAccounts` instructions', () => {
        const mint = Keypair.generate().publicKey;
        const destination = Keypair.generate().publicKey;
        const authority = Keypair.generate().publicKey;
        const source0 = Keypair.generate().publicKey;
        const source1 = Keypair.generate().publicKey;

        it('should decode with a single authority and no multisig signers', () => {
            const instruction = createWithdrawWithheldTokensFromAccountsInstruction(
                mint,
                destination,
                authority,
                [],
                [source0, source1],
            );
            const decoded = decodeWithdrawWithheldTokensFromAccountsInstruction(instruction, TOKEN_2022_PROGRAM_ID);
            expect(decoded.data.numTokenAccounts).to.eql(2);
            expect(decoded.keys.signers?.map(meta => meta.pubkey)).to.eql([]);
            expect(decoded.keys.sources?.map(meta => meta.pubkey)).to.eql([source0, source1]);
        });

        it('should decode all multisig signers with multiple sources', () => {
            const signer0 = Keypair.generate().publicKey;
            const signer1 = Keypair.generate().publicKey;
            const signer2 = Keypair.generate().publicKey;
            const instruction = createWithdrawWithheldTokensFromAccountsInstruction(
                mint,
                destination,
                authority,
                [signer0, signer1, signer2],
                [source0, source1],
            );
            const decoded = decodeWithdrawWithheldTokensFromAccountsInstruction(instruction, TOKEN_2022_PROGRAM_ID);
            expect(decoded.keys.signers?.map(meta => meta.pubkey)).to.eql([signer0, signer1, signer2]);
            expect(decoded.keys.sources?.map(meta => meta.pubkey)).to.eql([source0, source1]);
        });
    });

    describe('calculateFee', () => {
        it('should return 0 fee when transferFeeBasisPoints is 0', () => {
            const transferFee = {
                epoch: 1n,
                maximumFee: 100n,
                transferFeeBasisPoints: 0,
            };
            const preFeeAmount = 100n;
            const fee = calculateFee(transferFee, preFeeAmount);
            expect(fee).to.eql(0n);
        });

        it('should return 0 fee when preFeeAmount is 0', () => {
            const transferFee = {
                epoch: 1n,
                maximumFee: 100n,
                transferFeeBasisPoints: 100,
            };
            const preFeeAmount = 0n;
            const fee = calculateFee(transferFee, preFeeAmount);
            expect(fee).to.eql(0n);
        });

        it('should calculate the fee correctly when preFeeAmount is non-zero', () => {
            const transferFee = {
                epoch: 1n,
                maximumFee: 100n,
                transferFeeBasisPoints: 50,
            };
            const preFeeAmount = 500n;
            const fee = calculateFee(transferFee, preFeeAmount);
            expect(fee).to.eql(3n);
        });

        it('fee should be equal to maximum fee', () => {
            const transferFee = {
                epoch: 1n,
                maximumFee: 5000n,
                transferFeeBasisPoints: 50,
            };
            const preFeeAmount = transferFee.maximumFee;
            const fee = calculateFee(transferFee, preFeeAmount * ONE_IN_BASIS_POINTS);
            expect(fee).to.eql(transferFee.maximumFee);
        });
        it('fee should be equal to maximum fee when added 1 to preFeeAmount', () => {
            const transferFee = {
                epoch: 1n,
                maximumFee: 5000n,
                transferFeeBasisPoints: 50,
            };
            const preFeeAmount = transferFee.maximumFee;
            const fee = calculateFee(transferFee, preFeeAmount * ONE_IN_BASIS_POINTS + 1n);
            expect(fee).to.eql(transferFee.maximumFee);
        });
    });

    describe('calculateEpochFee', () => {
        const transferFeeConfig = {
            transferFeeConfigAuthority: null,
            withdrawWithheldAuthority: null,
            withheldAmount: 500n,
            olderTransferFee: {
                epoch: 1n,
                maximumFee: 100n,
                transferFeeBasisPoints: 50,
            },
            newerTransferFee: {
                epoch: 2n,
                maximumFee: 200n,
                transferFeeBasisPoints: 75,
            },
        };

        it('should return olderTransferFee when epoch is less than newerTransferFee.epoch', () => {
            const preFeeAmount = 200n;
            const epoch = 1n;
            const fee = calculateEpochFee(transferFeeConfig, epoch, preFeeAmount);
            expect(fee).to.eql(1n);
        });

        it('should return newerTransferFee when epoch is greater than or equal to newerTransferFee.epoch', () => {
            const preFeeAmount = 200n;
            const epoch = 2n;
            const fee = calculateEpochFee(transferFeeConfig, epoch, preFeeAmount);
            expect(fee).to.eql(2n);
        });

        it('should cap the fee to the maximumFee when calculated fee exceeds maximumFee', () => {
            const preFeeAmount = 500n;
            const epoch = 2n;
            const fee = calculateEpochFee(transferFeeConfig, epoch, preFeeAmount);
            expect(fee).to.eql(4n);
        });
    });
});

describe('transfer fee config state', () => {
    const fees = {
        withheldAmount: 11n,
        olderTransferFee: { epoch: 12n, maximumFee: 13n, transferFeeBasisPoints: 14 },
        newerTransferFee: { epoch: 15n, maximumFee: 16n, transferFeeBasisPoints: 17 },
    };
    const presentTransferFeeConfigAuthority = PublicKey.unique();
    const presentWithdrawWithheldAuthority = PublicKey.unique();

    for (const transferFeeConfigAuthority of [presentTransferFeeConfigAuthority, null]) {
        for (const withdrawWithheldAuthority of [presentWithdrawWithheldAuthority, null]) {
            it(`decodes ${transferFeeConfigAuthority ? 'present' : 'absent'} config authority and ${withdrawWithheldAuthority ? 'present' : 'absent'} withdraw authority`, () => {
                const rawState = {
                    ...fees,
                    transferFeeConfigAuthority: transferFeeConfigAuthority ?? PublicKey.default,
                    withdrawWithheldAuthority: withdrawWithheldAuthority ?? PublicKey.default,
                };
                const tlvData = Buffer.alloc(4 + TransferFeeConfigLayout.span);
                tlvData.writeUInt16LE(ExtensionType.TransferFeeConfig, 0);
                tlvData.writeUInt16LE(TransferFeeConfigLayout.span, 2);
                TransferFeeConfigLayout.encode(rawState, tlvData, 4);

                expect(TransferFeeConfigLayout.decode(tlvData, 4)).to.eql(rawState);
                expect(getTransferFeeConfig({ tlvData } as Mint)).to.eql({
                    ...fees,
                    transferFeeConfigAuthority,
                    withdrawWithheldAuthority,
                });
            });
        }
    }

    it('returns null when the extension is absent', () => {
        expect(getTransferFeeConfig({ tlvData: Buffer.alloc(0) } as Mint)).to.equal(null);
    });
});
