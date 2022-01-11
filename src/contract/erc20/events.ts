import type { BigNumber } from 'ethers';

export type GeneratedCommitmentBatchEvent = {
  transactionHash: string,
  args: {
    treeNumber: BigNumber,
    startPosition: BigNumber,
    commitments: {
      pubkey: [BigNumber, BigNumber],
      random: BigNumber,
      amount: BigNumber,
      token: string,
    },
  },
};

export type CommitmentBatchEvent = {
  transactionHash: string,
  args: {
    treeNumber: BigNumber,
    startPosition: BigNumber,
    commitments: {
      pubkey: [BigNumber, BigNumber],
      random: BigNumber,
      amount: BigNumber,
      token: string,
    },
  },
};

export type GeneratedCommitmentEvent = {
  transactionHash: string,
  args: {
    treeNumber: BigNumber,
    startPosition: BigNumber,
    commitments: {
      pubkey: [BigNumber, BigNumber],
      random: BigNumber,
      amount: BigNumber,
      token: string,
    },
  },
};

export type CommitmentEvent = {
  transactionHash: string,
  args: {
    treeNumber: BigNumber,
    startPosition: BigNumber,
    commitments: {
      pubkey: [BigNumber, BigNumber],
      random: BigNumber,
      amount: BigNumber,
      token: string,
    },
  },
};

export type NullifierEvent = {
  transactionHash: string,
  args: {
    treeNumber: BigNumber,
    startPosition: BigNumber,
    commitments: {
      pubkey: [BigNumber, BigNumber],
      random: BigNumber,
      amount: BigNumber,
      token: string,
    },
  },
};

function formatGeneratedCommitment(event: GeneratedCommitment) {

}

function formatGeneratedCommitmentBatch(event: GeneratedCommitmentBatch) {

}

function formatCommitment(events: Commitment) {

}

function formatCommitmentBatch(events: CommitmentBatch) {

}

function formatNullifier(event: NullifierEvent) {

}

export default {
  formatGeneratedCommitment,
  formatGeneratedCommitmentBatch,
  formatCommitment,
  formatCommitmentBatch,
  formatNullifier,
};
