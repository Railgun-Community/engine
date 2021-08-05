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
  beforeEach(() => {
    // Create database
    db = new Database(testConfig.dbpath);
  });

  it('Should create database', async () => {
    // Put value in database
    await db.level.put('a', '1');

    // Check if value is returned correctly
    expect(await db.level.get('a')).to.equal('1');
  });

  it('Should create database from existing level object', async () => {
    // Create database from level object
    const db2: Database = new Database(level(`${testConfig.dbpath}2`));

    // Put value in database
    await db2.level.put('a', '1');

    // Check if value is returned correctly
    expect(await db2.level.get('a')).to.equal('1');

    // Clean up database
    db2.level.close();
    rimraf(`${testConfig.dbpath}2`, () => {});
  });

  afterEach(() => {
    // Clean up database
    db.level.close();
    rimraf(testConfig.dbpath, () => {});
  });
});
