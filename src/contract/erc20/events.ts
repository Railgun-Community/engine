import type { BigNumber } from 'ethers';
import { EncryptedCommitment, GeneratedCommitment } from '../../merkletree';
import { ERC20Note } from '../../note/erc20';
import { babyjubjub, bytes } from '../../utils';

export type CommitmentTokenData = {
  tokenType: BigNumber;
  address: BigNumber;
  tokenSubID: BigNumber;
};

export type GeneratedCommitmentArgs = {
  ypubkey: BigNumber;
  sign: boolean;
  value: BigNumber;
  random: BigNumber;
  tokenData: CommitmentTokenData;
};

export type EncryptedCommitmentArgs = {
  hash: BigNumber;
  ciphertext: BigNumber[];
  senderPubKey: BigNumber[];
  revealKey: BigNumber[];
};

export function formatGeneratedCommitmentBatchCommitments(
  transactionHash: string,
  commitments: GeneratedCommitmentArgs[],
): GeneratedCommitment[] {
  return commitments.map((commit) => {
    const note = ERC20Note.deserialize({
      ypubkey: bytes.hexlify(commit.ypubkey.toHexString()),
      sign: commit.sign,
      random: bytes.hexlify(commit.random.toHexString()),
      value: bytes.hexlify(commit.value.toHexString()),
      token: bytes.hexlify(commit.tokenData.address.toHexString(), true),
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
      revealKey: commit.revealKey.map((el) => el.toHexString()),
    };
  });
}

export function formatNullifier(transactionHash: string, nullifier: BigNumber) {
  return {
    txid: transactionHash,
    nullifier: nullifier.toHexString(),
  };
}
