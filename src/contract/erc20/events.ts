import type { BigNumber } from 'ethers';
import { EncryptedCommitment, GeneratedCommitment } from '../../merkletree';
import { ERC20Note } from '../../note/erc20';
import { babyjubjub, bytes } from '../../utils';

export type GeneratedCommitmentArgs = {
  pubkey: [BigNumber, BigNumber];
  random: BigNumber;
  amount: BigNumber;
  token: string;
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
  return commitments.map((commit: any) => {
    const note = ERC20Note.deserialize({
      pubkey: babyjubjub.packPoint(commit.pubkey.map((el: any) => el.toHexString())),
      random: bytes.hexlify(commit.random.toHexString()),
      amount: bytes.hexlify(commit.amount.toHexString()),
      token: bytes.hexlify(commit.token, true),
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
  return commitments.map((commit: any) => {
    const ciphertexthexlified = commit.ciphertext.map((el: any) => el.toHexString());
    return {
      hash: commit.hash.toHexString(),
      txid: transactionHash,
      senderPubKey: babyjubjub.packPoint(commit.senderPubKey.map((el: any) => el.toHexString())),
      ciphertext: {
        iv: ciphertexthexlified[0],
        data: ciphertexthexlified.slice(1),
      },
    };
  });
}

export function formatGeneratedCommitment(
  transactionHash: string,
  commitment: GeneratedCommitmentArgs,
): GeneratedCommitment {
  const note = ERC20Note.deserialize({
    pubkey: babyjubjub.packPoint(commitment.pubkey.map((el: any) => el.toHexString())),
    random: bytes.hexlify(commitment.random.toHexString()),
    amount: bytes.hexlify(commitment.amount.toHexString()),
    token: bytes.hexlify(commitment.token, true),
  });
  return {
    hash: note.hash,
    txid: transactionHash,
    data: note.serialize(),
  };
}

export function formatEncryptedCommitment(
  transactionHash: string,
  commitment: EncryptedCommitmentArgs,
): EncryptedCommitment {
  const ciphertexthexlified = commitment.ciphertext.map((el: any) => el.toHexString());
  return {
    hash: commitment.hash.toHexString(),
    txid: transactionHash,
    senderPubKey: babyjubjub.packPoint(commitment.senderPubKey.map((el: any) => el.toHexString())),
    ciphertext: {
      iv: ciphertexthexlified[0],
      data: ciphertexthexlified.slice(1),
    },
  };
}

export function formatNullifier(transactionHash: string, nullifier: BigNumber) {
  return {
    txid: transactionHash,
    nullifier: nullifier.toHexString(),
  };
}
