import { LeptonDebugger } from '../models/types';

export default class LeptonDebug {
  private static leptonDebugger: LeptonDebugger | undefined;

  static init(leptonDebugger: LeptonDebugger) {
    this.leptonDebugger = leptonDebugger;
  }

  static log(msg: string) {
    this.leptonDebugger?.log(msg);
  }

  static error(err: Error) {
    this.leptonDebugger?.error(err);
  }
}
