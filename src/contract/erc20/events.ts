import type { BigNumber } from 'ethers';
import { EncryptedCommitment, GeneratedCommitment } from '../../merkletree';
import { WithdrawNote } from '../../note';
import { EncryptedRandom } from '../../transaction/types';
import { hexlify } from '../../utils/bytes';

export type CommitmentCiphertextArgs = {
  ciphertext: [BigNumber, BigNumber, BigNumber, BigNumber];
  ephemeralKeys: [BigNumber, BigNumber];
  memo: string;
};

export type CommitmentTokenData = {
  tokenType: BigNumber;
  tokenAddress: string;
  tokenSubID: BigNumber;
};

export type CommitmentPreimageArgs = {
  npk: BigNumber;
  token: CommitmentTokenData;
  value: BigNumber;
};

export type EncryptedCommitmentArgs = {
  hash: BigNumber;
  ciphertext: CommitmentCiphertextArgs[];
};

type EventTokenData = { tokenType: BigNumber; tokenAddress: string; tokenSubID: BigNumber };

const formatTokenData = (token: EventTokenData) => ({
  tokenType: token.tokenType.toString(),
  tokenAddress: token.tokenAddress,
  tokenSubID: token.tokenSubID.toString(),
});

export function formatGeneratedCommitmentBatchCommitments(
  transactionHash: string,
  preImages: CommitmentPreimageArgs[],
  encryptedRandom: [BigNumber, BigNumber][],
): GeneratedCommitment[] {
  const randomFormatted = encryptedRandom.map(
    (el): EncryptedRandom => [el[0].toHexString(), el[1].toHexString()],
  );
  const preImagesFormatted = preImages.map((preImage, index) => {
    const token = formatTokenData(preImage.token);
    // @todo generalize to preimage (withdraw + deposit)
    const note = new WithdrawNote(preImage.npk.toHexString(), preImage.value.toBigInt(), token);
    return {
      hash: note.hash,
      txid: transactionHash,
      data: note.serialize(randomFormatted[index]),
    };
  });
  return preImagesFormatted;
}

export function formatEncryptedCommitmentBatchCommitments(
  transactionHash: string,
  hash: BigNumber[],
  commitments: CommitmentCiphertextArgs[],
): EncryptedCommitment[] {
  return commitments.map((commitment, index) => {
    const { ephemeralKeys, memo } = commitment;
    const ciphertext = commitment.ciphertext.map((el) => hexlify(el.toHexString()));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const ivTag = ciphertext[0];

    return {
      hash: hash[index].toHexString(),
      txid: transactionHash,
      ciphertext: {
        ciphertext: {
          iv: ivTag.substring(0, 16),
          tag: ivTag.substring(16),
          data: ciphertext.slice(1),
        },
        ephemeralKeys: ephemeralKeys.map((key) => hexlify(key.toHexString())),
        memo,
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
