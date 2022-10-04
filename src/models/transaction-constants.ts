export const DEFAULT_TOKEN_SUB_ID = BigInt(0);

export const WithdrawFlag = {
  NO_WITHDRAW: BigInt(0),
  WITHDRAW: BigInt(1),
  OVERRIDE: BigInt(2),
} as const;

// 15 bytes: 00
export const MEMO_SENDER_BLINDING_KEY_NULL = '000000000000000000000000000000';
