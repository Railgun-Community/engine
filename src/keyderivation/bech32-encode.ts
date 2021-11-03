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
function encode(key: BytesData, chainID: number | undefined = undefined, version: number = 1) {
  // TODO: Remove reliance on bech32-buffer
  // Combine key and version byte
  const data = new Uint8Array(utils.bytes.arrayify(utils.bytes.combine([new BN(version), key])));

  if (chainID && prefixes[chainID]) {
    // Prefix exists, encode and return with prefix
    return bech32.encode(prefixes[chainID], data);
  }

  // Prefix doesn't exist, encode with generic prefix
  return bech32.encode('rgany', data);
}

function decode(address: string) {
  // TODO: Remove reliance on bech32-buffer
  const decoded = bech32.decode(address);

  // Hexlify data
  const data = utils.bytes.hexlify(decoded.data);

  // Get version
  const version = parseInt(data.slice(0, 2), 16);

  // Get key
  const key = data.slice(2);

  // Get chainID
  const chainID = prefixes.includes(decoded.prefix) ? prefixes.indexOf(decoded.prefix) : undefined;

  return {
    chainID,
    version,
    key,
  };
}

export default {
  encode,
  decode,
};
