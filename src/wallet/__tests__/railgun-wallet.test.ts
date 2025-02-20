import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { utf8ToBytes } from 'ethereum-cryptography/utils';
import memdown from 'memdown';
import { verifyED25519 } from '../../utils/keys-utils';
import { RailgunWallet } from '../railgun-wallet';
import { ViewOnlyWallet } from '../view-only-wallet';
import { config } from '../../test/config.test';
import { Chain, ChainType } from '../../models/engine-types';
import { Database } from '../../database/database';
import { sha256 } from '../../utils/hash';
import { ByteUtils } from '../../utils/bytes';
import { RailgunEngine } from '../../railgun-engine';
import { Mnemonic } from '../../key-derivation/bip39';
import { UTXOMerkletree } from '../../merkletree/utxo-merkletree';
import { Prover } from '../../prover/prover';
import { getTestTXIDVersion, testArtifactsGetter } from '../../test/helper.test';
import { addChainSupportsV3 } from '../../chain/chain';

chai.use(chaiAsPromised);
const { expect } = chai;

const txidVersion = getTestTXIDVersion();

let db: Database;
let utxoMerkletree: UTXOMerkletree;
let wallet: RailgunWallet;
let viewOnlyWallet: ViewOnlyWallet;
const chain: Chain = {
  type: ChainType.EVM,
  id: 1,
};

const testMnemonic = config.mnemonic;
const testEncryptionKey = config.encryptionKey;

describe('railgun-wallet', () => {
  beforeEach(async () => {
    db = new Database(memdown());
    utxoMerkletree = await UTXOMerkletree.create(db, chain, txidVersion, async () => true);
    wallet = await RailgunWallet.fromMnemonic(
      db,
      testEncryptionKey,
      testMnemonic,
      0,
      undefined, // creationBlockNumbers
      new Prover(testArtifactsGetter),
    );
    addChainSupportsV3(chain);
    await wallet.loadUTXOMerkletree(txidVersion, utxoMerkletree);
    viewOnlyWallet = await ViewOnlyWallet.fromShareableViewingKey(
      db,
      testEncryptionKey,
      wallet.generateShareableViewingKey(),
      undefined, // creationBlockNumbers
      new Prover(testArtifactsGetter),
    );
    await viewOnlyWallet.loadUTXOMerkletree(txidVersion, utxoMerkletree);
    await wallet.clearDecryptedBalancesAllTXIDVersions(chain);
    await viewOnlyWallet.clearDecryptedBalancesAllTXIDVersions(chain);
  });

  it('Should load existing wallet', async () => {
    const wallet2 = await RailgunWallet.loadExisting(
      db,
      testEncryptionKey,
      wallet.id,
      new Prover(testArtifactsGetter),
    );
    expect(wallet2.id).to.equal(wallet.id);
  });

  it('Should load existing view-only wallet', async () => {
    const viewOnlyWallet2 = await ViewOnlyWallet.loadExisting(
      db,
      testEncryptionKey,
      viewOnlyWallet.id,
      new Prover(testArtifactsGetter),
    );
    expect(viewOnlyWallet2.id).to.equal(viewOnlyWallet.id);
  });

  it('Should get wallet prefix path', async () => {
    const path = wallet.getWalletDBPrefix(chain);
    expect(path[1]).to.equal(sha256(ByteUtils.combine([Mnemonic.toSeed(testMnemonic), '00'])));
    expect(path[1]).to.equal(wallet.id);
    expect(wallet.getWalletDBPrefix(chain)).to.deep.equal([
      '000000000000000000000000000000000000000000000000000077616c6c6574',
      'bee63912e0e4cfa6830ebc8342d3efa9aa1336548c77bf4336c54c17409f2990',
      '0000000000000000000000000000000000000000000000000000000000000001',
    ]);
  });

  it('Should get wallet details path', async () => {
    expect(wallet.getWalletDetailsPath(chain)).to.deep.equal([
      '000000000000000000000000000000000000000000000000000077616c6c6574',
      'bee63912e0e4cfa6830ebc8342d3efa9aa1336548c77bf4336c54c17409f2990',
      '0000000000000000000000000000000000000000000000000000000000000001',
      '64657461696c73',
    ]);
  });

  it('Should get viewing keypair', async () => {
    expect(wallet.getViewingKeyPair()).to.deep.equal({
      privateKey: new Uint8Array([
        157, 164, 180, 240, 181, 73, 58, 107, 163, 247, 223, 6, 17, 195, 224, 132, 47, 126, 43, 179,
        214, 64, 243, 19, 178, 53, 241, 183, 92, 29, 128, 185,
      ]),
      pubkey: new Uint8Array([
        119, 215, 170, 124, 91, 151, 128, 96, 190, 43, 167, 140, 188, 14, 249, 42, 79, 58, 163, 252,
        41, 128, 62, 175, 71, 132, 124, 245, 16, 185, 134, 234,
      ]),
    });
  });

  it('Should sign and verify with viewing keypair', async () => {
    const data = utf8ToBytes('20388293809abc');
    const signed = await wallet.signWithViewingKey(data);
    const { pubkey } = wallet.getViewingKeyPair();
    expect(await verifyED25519(data, signed, pubkey)).to.equal(true);
  });

  it('Should sign and verify with viewing keypair (view-only wallet)', async () => {
    const data = utf8ToBytes('20388293809abc');
    const signed = await viewOnlyWallet.signWithViewingKey(data);
    const { pubkey } = viewOnlyWallet.getViewingKeyPair();
    expect(await verifyED25519(data, signed, pubkey)).to.equal(true);
  });

  it('Should get spending keypair', async () => {
    expect(await wallet.getSpendingKeyPair(testEncryptionKey)).to.deep.equal({
      privateKey: new Uint8Array([
        176, 149, 143, 139, 194, 134, 174, 8, 50, 250, 131, 176, 27, 113, 154, 34, 90, 7, 206, 123,
        134, 31, 243, 17, 50, 63, 34, 22, 103, 179, 189, 80,
      ]),
      pubkey: [
        15684838006997671713939066069845237677934334329285343229142447933587909549584n,
        11878614856120328179849762231924033298788609151532558727282528569229552954628n,
      ],
    });
  });

  it('Should get address keys', async () => {
    expect(wallet.addressKeys).to.deep.equal({
      masterPublicKey:
        20060431504059690749153982049210720252589378133547582826474262520121417617087n,
      viewingPublicKey: new Uint8Array([
        119, 215, 170, 124, 91, 151, 128, 96, 190, 43, 167, 140, 188, 14, 249, 42, 79, 58, 163, 252,
        41, 128, 62, 175, 71, 132, 124, 245, 16, 185, 134, 234,
      ]),
    });
    expect(viewOnlyWallet.addressKeys).to.deep.equal({
      masterPublicKey:
        20060431504059690749153982049210720252589378133547582826474262520121417617087n,
      viewingPublicKey: new Uint8Array([
        119, 215, 170, 124, 91, 151, 128, 96, 190, 43, 167, 140, 188, 14, 249, 42, 79, 58, 163, 252,
        41, 128, 62, 175, 71, 132, 124, 245, 16, 185, 134, 234,
      ]),
    });
  });

  it('Should get addresses', async () => {
    expect(wallet.getAddress()).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48tlrv7j6fe3z53lama02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5ajy990',
    );
    expect(viewOnlyWallet.getAddress()).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48tlrv7j6fe3z53lama02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5ajy990',
    );
    expect(wallet.getAddress({ type: ChainType.EVM, id: 0 })).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7unpd9kxwatwqpma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5qq7f22',
    );
    expect(wallet.getAddress({ type: ChainType.EVM, id: 1 })).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7unpd9kxwatwq9ma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw56ltkfa',
    );
    expect(wallet.getAddress({ type: ChainType.EVM, id: 2 })).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7unpd9kxwatwqfma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5aha7vd',
    );
    expect(wallet.getAddress({ type: ChainType.EVM, id: 3 })).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7unpd9kxwatwqdma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw58ggp06',
    );
    expect(wallet.getAddress({ type: ChainType.EVM, id: 4 })).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7unpd9kxwatwq3ma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5n8cwxy',
    );
    expect(wallet.getAddress({ type: 1 as ChainType, id: 0 })).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7umpd9kxwatwqpma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5knt45s',
    );
    expect(wallet.getAddress({ type: 1 as ChainType, id: 1 })).to.equal(
      '0zk1qyk9nn28x0u3rwn5pknglda68wrn7gw6anjw8gg94mcj6eq5u48t7umpd9kxwatwq9ma02nutwtcqc979wnce0qwly4y7w4rls5cq040g7z8eagshxrw5vv72h8',
    );
  });

  it('Should get chain address correctly', async () => {
    const address = await wallet.getChainAddress(testEncryptionKey);
    expect(address).to.equal('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
  });

  it('Should derive addresses correctly', async () => {
    const address = wallet.getAddress(chain);
    const decoded = RailgunEngine.decodeAddress(address);
    expect(decoded.masterPublicKey).to.equal(wallet.masterPublicKey);
    expect(decoded.chain).to.deep.equal(chain);
  });

  it('Should get empty wallet details', async () => {
    const walletDetails = await wallet.getWalletDetails(txidVersion, chain);
    expect(walletDetails).to.deep.equal({
      treeScannedHeights: [],
      creationTree: undefined,
      creationTreeHeight: undefined,
    });
    const viewOnlyWalletDetails = await viewOnlyWallet.getWalletDetails(txidVersion, chain);
    expect(viewOnlyWalletDetails).to.deep.equal({
      treeScannedHeights: [],
      creationTree: undefined,
      creationTreeHeight: undefined,
    });
  });

  afterEach(async () => {
    // Clean up database
    wallet.unloadUTXOMerkletree(txidVersion, utxoMerkletree.chain);
    await db.close();
  });
});
