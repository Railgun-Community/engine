import { LeptonDebugger } from '../models/lepton-types';

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

  static error(err: Error, ignoreInTests = false) {
    if (this.leptonDebugger) {
      this.leptonDebugger.error(err);
    }
    if (process.env.NODE_ENV === 'test' && !ignoreInTests) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
  }
}
