/* globals describe it beforeEach afterEach */
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
import * as rimraf from 'rimraf';

import Database from '../../src/database';

chai.use(chaiAsPromised);
const { expect } = chai;

const testDBPath = './test/testDB';

let db: Database;

describe('Database', () => {
  beforeEach(() => {
    // Create database
    db = new Database(testDBPath);
  });

  it('Should create database', async () => {
    // Put value in database
    await db.level.put('a', '1');

    // Check if value is returned correctly
    expect(await db.level.get('a')).to.equal('1');
  });

  afterEach(() => {
    // Clean up database
    rimraf(testDBPath, () => {});
  });
});
