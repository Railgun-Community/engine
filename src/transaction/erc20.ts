import type BN from 'bn.js';

export type Output = {
  to: string,
  amount: BN
}

class ERC20Transaction {
  token: string;

  outputs: Output[] = [];

  deposit: BN | null = null;

  withdraw: BN | null = null;
}

export { ERC20Transaction };
