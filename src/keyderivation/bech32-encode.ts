import BN from 'bn.js';
import * as bech32 from 'bech32-buffer';
import utils from '../utils';
import type { BytesData } from '../utils/bytes';

const prefixes: string[] = [];
prefixes[1] = 'rgeth';
prefixes[3] = 'rgTESTropsten';
prefixes[5] = 'rgTESTgoerli';
prefixes[56] = 'rgbsc';
prefixes[137] = 'rgpoly';

/**
 * Bech32 encodes address
 * @param key - public key to encode
 * @param version - version
 * @param chainID - chainID to encode
 */
function encode(key: BytesData, chainID: number | undefined = undefined) {
  // TODO: Remove reliance on bech32-buffer
  // TODO: Add bit for chain type (EVM, Solana, etc.)
  // Combine key and version byte
  const data = new Uint8Array(
    utils.bytes.arrayify(utils.bytes.combine([new BN(utils.constants.VERSION), key])),
  );

  // Prefix exists, encode and return with prefix
  if (chainID && prefixes[chainID]) return bech32.encode(prefixes[chainID], data);

  // No chainID specified, throw error
  return bech32.encode('rgany', data);
}

function decode(address: string) {
  // TODO: Remove reliance on bech32-buffer
  const decoded = bech32.decode(address);

  // Hexlify data
  const data = utils.bytes.hexlify(decoded.data);

  // Get version
  const version = utils.bytes.numberify(data.slice(0, 2));

  // Throw if address version is not supported
  if (!version.eq(utils.constants.VERSION)) throw new Error('Incorrect address version');

  // Get key
  const key = data.slice(2);

  if (prefixes.includes(decoded.prefix)) {
    // If we know this prefix, then return with chainID
    return {
      chainID: prefixes.indexOf(decoded.prefix),
      key,
    };
  }

  if (decoded.prefix === 'rgany') {
    // If this is the generic prefix, return undefined
    return {
      chainID: undefined,
      key,
    };
  }

  // Don't know what this prefix is, throw
  throw new Error('Address prefix unrecognized');
}

export default {
  encode,
  decode,
};
