import { expect } from 'chai';
import {
  deriveEphemeralWallet,
  deriveEphemeralWalletFromPathSuffix,
  getEphemeralWalletBasePath,
} from '../ephemeral-key';

describe('Ephemeral Key Derivation', () => {
  const mnemonic = 'test test test test test test test test test test test junk';
  const railgunIndex = 0;
  const chainId = 1n;

  it('should derive a wallet with the correct path', () => {
    const index = 0;
    const wallet = deriveEphemeralWallet(
      mnemonic,
      railgunIndex,
      chainId,
      index,
    );
    
    expect(wallet).to.not.be.undefined;
    expect(wallet.path).to.equal("m/44'/60'/0'/7702'/0'/1'/0'");
    expect(wallet.address).to.be.a('string');
  });

  it('should derive different wallets for different indices', () => {
    const wallet0 = deriveEphemeralWallet(
      mnemonic,
      railgunIndex,
      chainId,
      0,
    );
    const wallet1 = deriveEphemeralWallet(
      mnemonic,
      railgunIndex,
      chainId,
      1,
    );

    expect(wallet0.address).to.not.equal(wallet1.address);
  });

  it('should derive different wallets for different chain IDs', () => {
    const walletChain1 = deriveEphemeralWallet(
      mnemonic,
      railgunIndex,
      1n,
      0,
    );
    const walletChain10 = deriveEphemeralWallet(
      mnemonic,
      railgunIndex,
      10n,
      0,
    );

    expect(walletChain1.address).to.not.equal(walletChain10.address);
  });

  it('should be deterministic', () => {
    const walletA = deriveEphemeralWallet(
      mnemonic,
      railgunIndex,
      chainId,
      5,
    );
    const walletB = deriveEphemeralWallet(
      mnemonic,
      railgunIndex,
      chainId,
      5,
    );

    expect(walletA.address).to.equal(walletB.address);
    expect(walletA.privateKey).to.equal(walletB.privateKey);
  });

  it('should derive different wallets for different railgun wallet indices', () => {
    const walletIndex0 = deriveEphemeralWallet(mnemonic, 0, chainId, 0);
    const walletIndex1 = deriveEphemeralWallet(mnemonic, 1, chainId, 0);

    expect(walletIndex0.address).to.not.equal(walletIndex1.address);
  });

  it('should derive a wallet from a relative path suffix', () => {
    const wallet = deriveEphemeralWalletFromPathSuffix(
      mnemonic,
      getEphemeralWalletBasePath(0, 1n),
      "5'",
    );

    expect(wallet.path).to.equal("m/44'/60'/0'/7702'/0'/1'/5'");
  });

  it('should reject an absolute path suffix', () => {
    expect(() =>
      deriveEphemeralWalletFromPathSuffix(
        mnemonic,
        getEphemeralWalletBasePath(0, 1n),
        "m/44'/60'/0'/7702'/0'/1'/5'",
      ),
    ).to.throw('Ephemeral wallet derivation path suffix must be relative.');
  });
});
