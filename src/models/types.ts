export type LeptonDebugger = {
  log: (msg: string) => void;
  error: (error: Error) => void;
}
