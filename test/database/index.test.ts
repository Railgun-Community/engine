/* eslint-disable no-unused-expressions */
/* globals describe it beforeEach afterEach */
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

import * as rimraf from 'rimraf';
import * as level from 'level';

import testConfig from '../config.test';

import Database from '../../src/database';

chai.use(chaiAsPromised);
const { expect } = chai;

// Database object for tests
let db: Database;

describe('Database', () => {
  beforeEach(async () => {
    // Create database
    db = new Database(testConfig.dbpath);
  });

  it('Should create database', async () => {
    // Put value in database
    await db.put('a', '1');

    // Check if value is returned correctly
    expect(await db.get('a')).to.equal('1');
  });

  it('Should create database from existing level object', async () => {
    // Create database from level object
    const db2: Database = new Database(level(`${testConfig.dbpath}2`));

    // Put value in database
    await db2.put('a', '1');

    // Check if value is returned correctly
    expect(await db2.get('a')).to.equal('1');

    // Clean up database
    db2.level.close();
    rimraf(`${testConfig.dbpath}2`, () => {});
  });

  it('Should perform CRUD operations on database', async () => {
    // Value should not exist yet
    await expect(db.get('a')).to.eventually.be.rejected;

    // Put value in database
    await db.put('a', '1');

    // Check if value is returned correctly
    expect(await db.get('a')).to.equal('1');

    // Delete value
    await db.del('a');

    // Check if value is deleted
    await expect(db.get('a')).to.eventually.be.rejected;

    // Should do a batch put operation
    await db.batch()
      .put('a', '1')
      .put('b', '2')
      .put('c', '3')
      .write();

    // Check if values are returned correctly
    expect(await db.get('a')).to.equal('1');
    expect(await db.get('b')).to.equal('2');
    expect(await db.get('c')).to.equal('3');

    // Should do a batch delete operation
    await db.batch()
      .del('a')
      .del('b')
      .del('c')
      .write();

    // Check if values are deleted
    await expect(db.get('a')).to.eventually.be.rejected;
    await expect(db.get('b')).to.eventually.be.rejected;
    await expect(db.get('c')).to.eventually.be.rejected;
  });

  it('Should delete values in a namespace', async () => {
    // Insert values in foo namespace
    await db.put('foo:a', '1');
    await db.put('foo:b', '2');
    await db.put('foo:c', '3');

    // Check if values are returned correctly
    expect(await db.get('foo:a')).to.equal('1');
    expect(await db.get('foo:b')).to.equal('2');
    expect(await db.get('foo:c')).to.equal('3');

    // Clear foo namespace
    await db.clearNamespace('foo');

    // Check if values are deleted
    await expect(db.get('foo:a')).to.eventually.be.rejected;
    await expect(db.get('foo:b')).to.eventually.be.rejected;
    await expect(db.get('foo:c')).to.eventually.be.rejected;
  });

  afterEach(() => {
    // Clean up database
    db.level.close();
    rimraf.sync(testConfig.dbpath);
  });
});
