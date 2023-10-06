import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import memdown from 'memdown';
import { config } from '../../test/config.test';
import { Database } from '../database';

chai.use(chaiAsPromised);
const { expect } = chai;

// Database object for tests
let db: Database;
const testEncryptionKey = config.encryptionKey;

describe('database', () => {
  beforeEach(async () => {
    // Create database
    db = new Database(memdown());
  });

  it('Should create database', async () => {
    // Put value in database
    await db.put(['a'], '01');

    // Check if value is returned correctly
    expect(await db.get(['a'])).to.equal('01');
  });

  it('Should perform CRUD operations on database', async () => {
    // Value should not exist yet
    await expect(db.get(['a'])).to.eventually.be.rejectedWith(
      'Key not found in database [000000000000000000000000000000000000000000000000000000000000000a]',
    );

    // Put value in database
    await db.put(['a'], '01');

    // Check if value is returned correctly
    expect(await db.get(['a'])).to.equal('01');

    // Delete value
    await db.del(['a']);

    // Check if value is deleted
    await expect(db.get(['a'])).to.eventually.be.rejectedWith(
      'Key not found in database [000000000000000000000000000000000000000000000000000000000000000a]',
    );
  });

  it('Should write and read encrypted values', async () => {
    // Put value in database
    await db.putEncrypted(['a', 'b'], testEncryptionKey, '01');

    // Check if value is returned correctly
    expect(await db.getEncrypted(['a', 'b'], testEncryptionKey)).to.equal('01');
  });

  it('Should perform batch operations on database', async () => {
    // Should do a batch put operation
    await db.batch([
      { type: 'put', key: 'a'.padStart(64, '0'), value: '01' },
      { type: 'put', key: 'b'.padStart(64, '0'), value: '02' },
      { type: 'put', key: 'c'.padStart(64, '0'), value: '03' },
    ]);

    // Check if values are returned correctly
    expect(await db.get(['a'])).to.equal('01');
    expect(await db.get(['b'])).to.equal('02');
    expect(await db.get(['c'])).to.equal('03');

    // Should do a batch delete operation
    await db.batch([
      { type: 'del', key: 'a'.padStart(64, '0') },
      { type: 'del', key: 'b'.padStart(64, '0') },
      { type: 'del', key: 'c'.padStart(64, '0') },
    ]);

    // Check if values are deleted
    await expect(db.get(['a'])).to.eventually.be.rejectedWith(
      'Key not found in database [000000000000000000000000000000000000000000000000000000000000000a]',
    );
    await expect(db.get(['b'])).to.eventually.be.rejectedWith(
      'Key not found in database [000000000000000000000000000000000000000000000000000000000000000b]',
    );
    await expect(db.get(['c'])).to.eventually.be.rejectedWith(
      'Key not found in database [000000000000000000000000000000000000000000000000000000000000000c]',
    );
  });

  it('Should count values in a namespace', async () => {
    // Insert values in foo namespace
    await db.put(['a', 'a'], '01');
    await db.put(['a', 'b'], '02');
    await db.put(['a', 'c'], '03');

    // Check if values are returned correctly
    expect(await db.get(['a', 'a'])).to.equal('01');
    expect(await db.get(['a', 'b'])).to.equal('02');
    expect(await db.get(['a', 'c'])).to.equal('03');

    // Count namespace
    expect(await db.countNamespace(['a'])).to.equal(3);
  });

  it('Should clear values in a namespace', async () => {
    // Insert values in foo namespace
    await db.put(['a', 'a'], '01');
    await db.put(['a', 'b'], '02');
    await db.put(['a', 'c'], '03');

    // Check if values are returned correctly
    expect(await db.get(['a', 'a'])).to.equal('01');
    expect(await db.get(['a', 'b'])).to.equal('02');
    expect(await db.get(['a', 'c'])).to.equal('03');

    // Clear foo namespace
    await db.clearNamespace(['a']);

    // Check if values are deleted
    await expect(db.get(['a', 'a'])).to.eventually.be.rejectedWith(
      'Key not found in database [000000000000000000000000000000000000000000000000000000000000000a:000000000000000000000000000000000000000000000000000000000000000a]',
    );
    await expect(db.get(['a', 'b'])).to.eventually.be.rejectedWith(
      'Key not found in database [000000000000000000000000000000000000000000000000000000000000000a:000000000000000000000000000000000000000000000000000000000000000b]',
    );
    await expect(db.get(['a', 'c'])).to.eventually.be.rejectedWith(
      'Key not found in database [000000000000000000000000000000000000000000000000000000000000000a:000000000000000000000000000000000000000000000000000000000000000c]',
    );
  });

  it('Should convert byte array data to hex', async () => {
    // Insert values by bytes array
    await db.put([[0x1], [0xa]], [0xaa]);
    await db.put([[0x1], [0xb]], new Uint8Array([0xab]).buffer);
    await db.put([[0x1], [0xc]], new Uint8Array([0xac]));

    // Fetch values by hex
    expect(await db.get(['01', '0a'])).to.equal('aa');
    expect(await db.get(['01', '0b'])).to.equal('ab');
    expect(await db.get(['01', '0c'])).to.equal('ac');
  });

  afterEach(async () => {
    // Clean up database
    await db.close();
  });
});
