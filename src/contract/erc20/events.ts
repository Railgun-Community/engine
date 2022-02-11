import type { BigNumber } from 'ethers';
import { EncryptedCommitment, GeneratedCommitment } from '../../merkletree';
import { ERC20Note } from '../../note/erc20';
import { babyjubjub, bytes } from '../../utils';

export type GeneratedCommitmentArgs = {
  pubkey: [BigNumber, BigNumber];
  random: BigNumber;
  amount: BigNumber;
  token: BigNumber;
};

export type EncryptedCommitmentArgs = {
  hash: BigNumber;
  ciphertext: BigNumber[];
  senderPubKey: BigNumber[];
};

export function formatGeneratedCommitmentBatchCommitments(
  transactionHash: string,
  commitments: GeneratedCommitmentArgs[],
): GeneratedCommitment[] {
  return commitments.map((commit) => {
    const note = ERC20Note.deserialize({
      pubkey: babyjubjub.packPoint(commit.pubkey.map((el) => el.toHexString())),
      random: bytes.hexlify(commit.random.toHexString()),
      amount: bytes.hexlify(commit.amount.toHexString()),
      token: bytes.hexlify(commit.token.toHexString(), true),
    });
    return {
      hash: note.hash,
      txid: transactionHash,
      data: note.serialize(),
    };
  });
}

export function formatEncryptedCommitmentBatchCommitments(
  transactionHash: string,
  commitments: EncryptedCommitmentArgs[],
): EncryptedCommitment[] {
  return commitments.map((commit) => {
    const ciphertexthexlified = commit.ciphertext.map((el) => el.toHexString());
    return {
      hash: commit.hash.toHexString(),
      txid: transactionHash,
      senderPubKey: babyjubjub.packPoint(commit.senderPubKey.map((el) => el.toHexString())),
      ciphertext: {
        iv: ciphertexthexlified[0],
        data: ciphertexthexlified.slice(1),
      },
    };
  });
}

export function formatNullifier(transactionHash: string, nullifier: BigNumber) {
  return {
    txid: transactionHash,
    nullifier: nullifier.toHexString(),
  };
}
