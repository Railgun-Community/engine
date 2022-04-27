import { LeptonDebugger } from '../models/types';

export default class LeptonDebug {
  private static leptonDebugger: LeptonDebugger | undefined;

  static init(leptonDebugger: LeptonDebugger) {
    this.leptonDebugger = leptonDebugger;
  }

  static log(msg: string) {
    if (this.leptonDebugger) {
      this.leptonDebugger.log(msg);
    }
  }

  static error(err: Error) {
    if (this.leptonDebugger) {
      this.leptonDebugger.error(err);
    }
  }
}
