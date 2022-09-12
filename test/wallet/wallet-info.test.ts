/* globals describe it */
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import WalletInfo from '../../src/wallet/wallet-info';

chai.use(chaiAsPromised);
const { expect } = chai;

describe('Wallet Source/Index', () => {
  it('Should encode and decode wallet source', async () => {
    const walletSource = 'New Wallet';
    WalletInfo.setWalletSource(walletSource);
    const encoded = WalletInfo.getEncodedWalletSource();
    expect(WalletInfo.decodeWalletSource(encoded)).to.equal('new wallet');
  });

  it('Should fail for invalid wallet source', async () => {
    const walletSource = '!@#$%';
    expect(() => WalletInfo.setWalletSource(walletSource)).to.throw();
  });
});
