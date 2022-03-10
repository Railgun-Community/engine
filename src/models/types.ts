export type LeptonDebugger = {
  log: (msg: string) => void;
  error: (error: Error) => void;
};

export type KeyNode = {
  chainKey: string,
  chainCode: string,
};
