import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  calculateRailgunTransactionVerificationHash,
  getRailgunTxidLeafHash,
} from '../railgun-txid';
import { TXIDVersion } from '../../models';
import { ByteLength, nToHex } from '../../utils';
import { getGlobalTreePosition } from '../../poi/global-tree-position';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('railgun-txid', () => {
  it('Should get railgun transaction hash for txid merkletree', async () => {
    expect(
      getRailgunTxidLeafHash(
        12157249116530410877712851712509084797672039320300907005218073634829938454808n,
        0n,
        getGlobalTreePosition(99999, 99999),
        TXIDVersion.V2_PoseidonMerkle,
      ),
    ).to.equal(
      nToHex(
        20241071195545867095431884887423531306892427422293202401460555613931070025875n,
        ByteLength.UINT_256,
      ),
    );
  });

  it('Should calculate verificationHash', () => {
    expect(
      calculateRailgunTransactionVerificationHash(
        undefined,
        '0x1e52cee52f67c37a468458671cddde6b56390dcbdc4cf3b770badc0e78d66401',
      ),
    ).to.equal('0x099cd3ebcadaf6ff470d16bc0186fb5f26cd4103e9970effc9b6679478e11c72');
    expect(
      calculateRailgunTransactionVerificationHash(
        '0x099cd3ebcadaf6ff470d16bc0186fb5f26cd4103e9970effc9b6679478e11c72',
        '0x26d7d0d235dc1849e9794061ebc74e9ea211b8b5004081d26c7d086bdd3c0c35',
      ),
    ).to.equal('0x63b79987230ed89bcfbaf94c72c42515f116057e2c2f5d19c5b47d094858e874');
  });
});
