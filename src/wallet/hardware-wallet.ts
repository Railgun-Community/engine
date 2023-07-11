import { Signature } from 'circomlibjs';
import { PublicInputs } from '../models';
import { ViewOnlyWallet } from './view-only-wallet';

class HardwareWallet extends ViewOnlyWallet {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, class-methods-use-this
  async sign(_publicInputs: PublicInputs, _encryptionKey: string): Promise<Signature> {
    throw new Error('Signer not implemented for hardware wallet.');
  }
}

export { HardwareWallet };
