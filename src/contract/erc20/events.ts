import type { BigNumber } from 'ethers';

export type GeneratedCommitmentBatchEvent = {
  transactionHash: string;
  args: {
    treeNumber: BigNumber;
    startPosition: BigNumber;
    commitments: {
      pubkey: [BigNumber, BigNumber];
      random: BigNumber;
      amount: BigNumber;
      token: string;
    };
  };
};

export type CommitmentBatchEvent = {
  transactionHash: string;
  args: {
    treeNumber: BigNumber;
    startPosition: BigNumber;
    commitments: {
      pubkey: [BigNumber, BigNumber];
      random: BigNumber;
      amount: BigNumber;
      token: string;
    };
  };
};

export type GeneratedCommitmentEvent = {
  transactionHash: string;
  args: {
    treeNumber: BigNumber;
    startPosition: BigNumber;
    commitments: {
      pubkey: [BigNumber, BigNumber];
      random: BigNumber;
      amount: BigNumber;
      token: string;
    };
  };
};

export type CommitmentEvent = {
  transactionHash: string;
  args: {
    treeNumber: BigNumber;
    startPosition: BigNumber;
    commitments: {
      pubkey: [BigNumber, BigNumber];
      random: BigNumber;
      amount: BigNumber;
      token: string;
    };
  };
};

export type NullifierEvent = {
  transactionHash: string;
  args: {
    treeNumber: BigNumber;
    startPosition: BigNumber;
    commitments: {
      pubkey: [BigNumber, BigNumber];
      random: BigNumber;
      amount: BigNumber;
      token: string;
    };
  };
};

function formatGeneratedCommitment(event: GeneratedCommitmentEvent) {}

function formatGeneratedCommitmentBatch(event: GeneratedCommitmentBatchEvent) {}

function formatCommitment(event: CommitmentEvent) {}

function formatCommitmentBatch(event: CommitmentBatchEvent) {}

function formatNullifier(event: NullifierEvent) {}

export default {
  formatGeneratedCommitment,
  formatGeneratedCommitmentBatch,
  formatCommitment,
  formatCommitmentBatch,
  formatNullifier,
};
