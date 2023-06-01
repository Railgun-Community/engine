import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { mnemonicToPrivateKey } from '../mnemonic';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Key Derivation/Mnemonic', () => {
  it('Should convert mnemonic to private key', async () => {
    const vectors = [
      {
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        seed: '1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727',
      },
    ];

    vectors.forEach((vector) => {
      expect(mnemonicToPrivateKey(vector.mnemonic)).to.equal(vector.seed);
    });
  });
});
