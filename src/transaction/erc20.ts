import type BN from 'bn.js';

export type Output = {
  to: string,
  amount: BN
}

class ERC20Transaction {
  token: string | null = null;

  tree: number | null = null;

  outputs: Output[] = [];

  deposit: BN | null = null;

  withdraw: BN | null = null;
}

export default ERC20Transaction;
