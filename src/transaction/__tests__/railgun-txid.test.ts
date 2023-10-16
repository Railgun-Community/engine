import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { getRailgunTxidLeafHash } from '../railgun-txid';
import { RailgunTransaction, TXIDVersion } from '../../models';
import { ByteLength, nToHex } from '../../utils';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('railgun-txid', () => {
  it('Should get railgun transaction hash for txid merkletree', async () => {
    expect(
      getRailgunTxidLeafHash(
        12157249116530410877712851712509084797672039320300907005218073634829938454808n,
        {
          utxoTreeIn: 0,
          utxoTreeOut: 99999,
          utxoBatchStartPositionOut: 99999,
        } as RailgunTransaction,
        TXIDVersion.V2_PoseidonMerkle,
      ),
    ).to.equal(
      nToHex(
        20241071195545867095431884887423531306892427422293202401460555613931070025875n,
        ByteLength.UINT_256,
      ),
    );
  });
});
