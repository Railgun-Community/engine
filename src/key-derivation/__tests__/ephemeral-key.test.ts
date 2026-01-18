import { expect } from 'chai';
import { deriveEphemeralWallet } from '../ephemeral-key';

describe('Ephemeral Key Derivation', () => {
  const mnemonic = 'test test test test test test test test test test test junk';

  it('should derive a wallet with the correct path', () => {
    const index = 0;
    const wallet = deriveEphemeralWallet(mnemonic, index);
    
    expect(wallet).to.not.be.undefined;
    expect(wallet.path).to.equal("m/44'/60'/0'/7702/0");
    expect(wallet.address).to.be.a('string');
  });

  it('should derive different wallets for different indices', () => {
    const wallet0 = deriveEphemeralWallet(mnemonic, 0);
    const wallet1 = deriveEphemeralWallet(mnemonic, 1);

    expect(wallet0.address).to.not.equal(wallet1.address);
  });

  it('should be deterministic', () => {
    const walletA = deriveEphemeralWallet(mnemonic, 5);
    const walletB = deriveEphemeralWallet(mnemonic, 5);

    expect(walletA.address).to.equal(walletB.address);
    expect(walletA.privateKey).to.equal(walletB.privateKey);
  });
});
