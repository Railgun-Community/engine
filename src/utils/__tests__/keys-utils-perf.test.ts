import { randomBytes } from '@noble/hashes/utils';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { before } from 'mocha';
import { spawn, Transfer, Worker, Pool } from 'threads';
import {
  getPrivateScalarFromPrivateKey,
  getPublicViewingKey,
  getSharedSymmetricKey,
} from '../keys-utils';
import { hexStringToBytes } from '../bytes';
import { sha256 } from '../hash';
import { initCurve25519Promise, scalarMultiplyJavascript } from '../scalar-multiply';

chai.use(chaiAsPromised);
const { expect } = chai;

// For test comparison with live WASM implementation.
async function getSharedSymmetricKeyJavascript(
  privateKeyPairA: Uint8Array,
  blindedPublicKeyPairB: Uint8Array,
) {
  // Retrieve private scalar from private key
  const scalar: bigint = await getPrivateScalarFromPrivateKey(privateKeyPairA);

  // Multiply ephemeral key by private scalar to get shared key
  const keyPreimage: Uint8Array = scalarMultiplyJavascript(blindedPublicKeyPairB, scalar);

  // SHA256 hash to get the final key
  const hashed: Uint8Array = hexStringToBytes(sha256(keyPreimage));
  return hashed;
}

const TOTAL = 3000;
const inputs: Array<[Uint8Array, Uint8Array]> = [];
let jsDuration: number;
let jsPoolDuration: number;
let wasmDuration: number;
let wasmPoolDuration: number;

describe('keys-utils performance', () => {
  before(async () => {
    for (let i = 0; i < TOTAL; i += 1) {
      const privateKeyPairA = randomBytes(32);
      const privateKeyPairB = randomBytes(32);
      // eslint-disable-next-line no-await-in-loop
      const publicKeyPairB = await getPublicViewingKey(privateKeyPairB);
      inputs.push([privateKeyPairA, publicKeyPairB]);
    }
  });

  it('JavaScript performance', async () => {
    const start = performance.now();
    // eslint-disable-next-line no-restricted-syntax
    for (const [privateKeyPairA, blindedPublicKeyPairB] of inputs) {
      // eslint-disable-next-line no-await-in-loop
      await getSharedSymmetricKeyJavascript(privateKeyPairA, blindedPublicKeyPairB);
    }
    const end = performance.now();
    jsDuration = end - start;
    const durationPerCall = (jsDuration / TOTAL).toFixed(2);
    // eslint-disable-next-line no-console
    console.log(`JS getSharedSymmetricKey: ${durationPerCall}ms per call`);
  });

  it.skip('JavaScript worker pool performance', async () => {
    const pool = Pool(() => spawn(new Worker('../keys-utils-worker-js')), 10);
    const start = performance.now();
    // eslint-disable-next-line no-restricted-syntax
    for (const [privateKeyPairA, blindedPublicKeyPairB] of inputs) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises, no-await-in-loop
      pool.queue((fn: CallableFunction) =>
        fn(Transfer(privateKeyPairA.buffer), Transfer(blindedPublicKeyPairB.buffer)),
      );
    }
    await pool.completed();
    const end = performance.now();
    jsPoolDuration = end - start;
    const durationPerCall = (jsPoolDuration / TOTAL).toFixed(2);
    // eslint-disable-next-line no-console
    console.log(`JS worker pool getSharedSymmetricKey: ${durationPerCall}ms per call`);
    await pool.terminate();
  })

  it('WASM performance', async () => {
    await expect(initCurve25519Promise).to.not.be.rejectedWith('some error');
    const start = performance.now();
    // eslint-disable-next-line no-restricted-syntax
    for (const [privateKeyPairA, blindedPublicKeyPairB] of inputs) {
      // eslint-disable-next-line no-await-in-loop
      await getSharedSymmetricKey(privateKeyPairA, blindedPublicKeyPairB);
    }
    const end = performance.now();
    wasmDuration = end - start;
    const durationPerCall = (wasmDuration / TOTAL).toFixed(2);
    // eslint-disable-next-line no-console
    console.log(`WASM getSharedSymmetricKey: ${durationPerCall}ms per call`);
  });

  it('WASM worker pool performance', async () => {
    const pool = Pool(() => spawn(new Worker('../keys-utils-worker')), 8);
    const start = performance.now();
    // eslint-disable-next-line no-restricted-syntax
    for (const [privateKeyPairA, blindedPublicKeyPairB] of inputs) {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises, no-await-in-loop
      pool.queue((fn: CallableFunction) =>
        fn(Transfer(privateKeyPairA.buffer), Transfer(blindedPublicKeyPairB.buffer)),
      );
    }
    await pool.completed();
    const end = performance.now();
    wasmPoolDuration = end - start;
    const durationPerCall = (wasmPoolDuration / TOTAL).toFixed(2);
    // eslint-disable-next-line no-console
    console.log(`WASM worker pool getSharedSymmetricKey: ${durationPerCall}ms per call`);
    await pool.terminate();
  });

  it.skip('WASM should be 5x-10x faster than JavaScript', () => {
    expect(wasmDuration).to.be.lessThan(jsDuration, 'WASM should be faster than JavaScript');
    expect(wasmDuration * 5).to.be.lessThan(
      jsDuration,
      'WASM should be at least 5x faster than JavaScript',
    );
    expect(wasmDuration * 10).to.be.greaterThan(
      jsDuration,
      'WASM should be at most 10x faster than JavaScript',
    );
  });
});
