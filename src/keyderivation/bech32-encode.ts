import BN from 'bn.js';
import { encode as bech32encode, decode as bech32decode } from 'bech32-buffer';
import { bytes, constants } from '../utils';
import type { BytesData } from '../utils/bytes';

const prefixes: string[] = [];
prefixes[1] = 'rgeth';
prefixes[3] = 'rgTESTropsten';
prefixes[5] = 'rgTESTgoerli';
prefixes[56] = 'rgbsc';
prefixes[137] = 'rgpoly';

/**
 * Bech32 encodes address
 * @param publicKey - public key to encode
 * @param version - version
 * @param chainID - chainID to encode
 */
function encode(publicKey: BytesData, chainID: number | undefined = undefined) {
  // TODO: Remove reliance on bech32-buffer
  // TODO: Add bit for chain type (EVM, Solana, etc.)
  // Combine key and version byte
  const data = new Uint8Array(
    bytes.arrayify(bytes.combine([new BN(constants.VERSION), publicKey])),
  );

  // Prefix exists, encode and return with prefix
  if (chainID && prefixes[chainID]) return bech32encode(prefixes[chainID], data);

  // No chainID specified, throw error
  return bech32encode('rgany', data);
}

function decode(address: string) {
  // TODO: Remove reliance on bech32-buffer
  const decoded = bech32decode(address);

  // Hexlify data
  const data = bytes.hexlify(decoded.data);

  // Get version
  const version = bytes.numberify(data.slice(0, 2));

  // Throw if address version is not supported
  if (!version.eq(constants.VERSION)) throw new Error('Incorrect address version');

  // Get key
  const publicKey = data.slice(2);

  if (prefixes.includes(decoded.prefix)) {
    // If we know this prefix, then return with chainID
    return {
      chainID: prefixes.indexOf(decoded.prefix),
      publicKey,
    };
  }

  if (decoded.prefix === 'rgany') {
    // If this is the generic prefix, return undefined
    return {
      chainID: undefined,
      publicKey,
    };
  }

  // Don't know what this prefix is, throw
  throw new Error('Address prefix unrecognized');
}

export {
  encode,
  decode,
};
