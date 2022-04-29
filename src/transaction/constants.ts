export const DEFAULT_TOKEN_SUB_ID = BigInt(0);

export const NOTE_INPUTS = {
  small: 2,
  large: 10,
};

export const NOTE_OUTPUTS = 3;

export const WithdrawFlag = {
  NO_WITHDRAW: BigInt(0),
  WITHDRAW: BigInt(1),
  OVERRIDE: BigInt(2),
} as const;
