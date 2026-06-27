import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import Sinon, { SinonStub } from 'sinon';
import { HDNodeWallet } from 'ethers';
import { Chain, ChainType } from '../../models/engine-types';
import { RailgunWallet } from '../railgun-wallet';
import { EphemeralKeyManager } from '../ephemeral-key-manager';

chai.use(chaiAsPromised);
const { expect } = chai;

const MOCK_ENCRYPTION_KEY = '0x1234';
const MOCK_MNEMONIC = 'test test test test test test test test test test test junk';
const MOCK_CHAIN: Chain = { type: ChainType.EVM, id: 1 };

describe('engine ephemeral-key-manager', () => {
  let getEphemeralWalletStub: SinonStub;
  let incrementEphemeralKeyIndexStub: SinonStub;
  let setEphemeralKeyIndexIfGreaterStub: SinonStub;
  let getTransactionHistoryStub: SinonStub;
  let isCanonicalEphemeralProviderStub: SinonStub;
  let manager: EphemeralKeyManager;

  beforeEach(() => {
    const railgunWallet = {
      getEphemeralWallet: async () => {},
      incrementEphemeralKeyIndex: async () => {},
      setEphemeralKeyIndexIfGreater: async () => {},
      getTransactionHistory: async () => {},
      isCanonicalEphemeralProvider: () => true,
    } as unknown as RailgunWallet;

    getEphemeralWalletStub = Sinon.stub(railgunWallet, 'getEphemeralWallet');
    incrementEphemeralKeyIndexStub = Sinon.stub(railgunWallet, 'incrementEphemeralKeyIndex');
    setEphemeralKeyIndexIfGreaterStub = Sinon.stub(railgunWallet, 'setEphemeralKeyIndexIfGreater');
    getTransactionHistoryStub = Sinon.stub(railgunWallet, 'getTransactionHistory');
    isCanonicalEphemeralProviderStub = Sinon.stub(railgunWallet, 'isCanonicalEphemeralProvider');
    isCanonicalEphemeralProviderStub.returns(true);

    manager = new EphemeralKeyManager(railgunWallet, MOCK_ENCRYPTION_KEY);
  });

  it('Should get wallet at index', async () => {
    const mockWallet = HDNodeWallet.fromPhrase(MOCK_MNEMONIC);
    getEphemeralWalletStub.resolves(mockWallet);

    const wallet = await manager.getWallet(BigInt(MOCK_CHAIN.id), 0);
    expect(wallet.address).to.equal(mockWallet.address);
    expect(getEphemeralWalletStub.calledWith(MOCK_ENCRYPTION_KEY, BigInt(MOCK_CHAIN.id), 0)).to.be.true;
  });

  it('Should get next wallet and increment index', async () => {
    const mockWallet = HDNodeWallet.fromPhrase(MOCK_MNEMONIC);
    incrementEphemeralKeyIndexStub.resolves(6);
    getEphemeralWalletStub.resolves(mockWallet);

    const wallet = await manager.getNextWallet(BigInt(MOCK_CHAIN.id));
    expect(wallet.address).to.equal(mockWallet.address);
    expect(incrementEphemeralKeyIndexStub.calledWith(BigInt(MOCK_CHAIN.id))).to.be.true;
    expect(getEphemeralWalletStub.calledWith(MOCK_ENCRYPTION_KEY, BigInt(MOCK_CHAIN.id), 6)).to.be.true;
  });

  it('Should scan history and recover index', async () => {
    const mockWallet0 = HDNodeWallet.fromPhrase(MOCK_MNEMONIC, undefined, "m/44'/60'/0'/7702/1'/0");
    const mockWallet1 = HDNodeWallet.fromPhrase(MOCK_MNEMONIC, undefined, "m/44'/60'/0'/7702/1'/1");
    const mockWallet2 = HDNodeWallet.fromPhrase(MOCK_MNEMONIC, undefined, "m/44'/60'/0'/7702/1'/2");

    getEphemeralWalletStub.withArgs(MOCK_ENCRYPTION_KEY, BigInt(MOCK_CHAIN.id), 0).resolves(mockWallet0);
    getEphemeralWalletStub.withArgs(MOCK_ENCRYPTION_KEY, BigInt(MOCK_CHAIN.id), 1).resolves(mockWallet1);
    getEphemeralWalletStub.withArgs(MOCK_ENCRYPTION_KEY, BigInt(MOCK_CHAIN.id), 2).resolves(mockWallet2);
    getEphemeralWalletStub.resolves(mockWallet2);

    getTransactionHistoryStub.resolves([
      {
        unshieldTokenAmounts: [{ recipientAddress: mockWallet1.address }],
      },
    ]);

    setEphemeralKeyIndexIfGreaterStub.resolves(2);

    const recoveredIndex = await manager.scanHistoryForEphemeralIndex(MOCK_CHAIN, 100);

    expect(recoveredIndex).to.equal(2);
    expect(setEphemeralKeyIndexIfGreaterStub.calledWith(BigInt(MOCK_CHAIN.id), 2)).to.be.true;
  });

  it('Should reject history scan for a custom (non-canonical) provider', async () => {
    isCanonicalEphemeralProviderStub.returns(false);

    await expect(manager.scanHistoryForEphemeralIndex(MOCK_CHAIN, 100)).to.be.rejectedWith(
      'only supported for the default ephemeral provider',
    );
  });
});
