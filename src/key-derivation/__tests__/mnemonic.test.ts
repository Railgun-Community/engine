import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { mnemonicToPrivateKey } from '../mnemonic';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('mnemonic', () => {
  it('Should convert mnemonic to private key', async () => {
    const vectors = [
      {
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        seed: '1ab42cc412b618bdea3a599e3c9bae199ebf030895b039e9db1e30dafb12b727',
      },
      {
        mnemonic:
          'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
        seed: '413cbeb8f83ecbd3c1e64f2ed89faac0ae89b5986fb4b010422e3056bbc61174',
        derivationIndex: 100,
      },
    ];

    vectors.forEach((vector) => {
      expect(mnemonicToPrivateKey(vector.mnemonic, vector.derivationIndex)).to.equal(vector.seed);
    });
  });
});
