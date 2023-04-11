export type EngineDebugger = {
  log: (msg: string) => void;
  error: (error: Error) => void;
};

export type KeyNode = {
  chainKey: string;
  chainCode: string;
};

export enum ChainType {
  EVM = 0,
}

export type Chain = {
  type: ChainType;
  id: number;
};
