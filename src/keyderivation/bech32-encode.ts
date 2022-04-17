// import BN from 'bn.js';
import { bech32 } from '@scure/base';
import { BN } from 'bn.js';
import { bytes, constants } from '../utils';

const prefixes: string[] = [];
prefixes[1] = 'rgeth';
prefixes[3] = 'rgtestropsten';
prefixes[5] = 'rgtestgoerli';
prefixes[56] = 'rgbsc';
prefixes[137] = 'rgpoly';

export type AddressData = {
  masterPublicKey: string;
  chainID?: number;
  version?: number;
};

/**
 * Bech32 encodes address
 * @param pubkey - public key to encode
 * @param version - version
 * @param chainID - chainID to encode
 */
function encode(data: AddressData): string {
  const { masterPublicKey, chainID } = data;
  // Combine key and version byte
  const words = bech32.toWords(
    new Uint8Array(bytes.arrayify(bytes.combine([new BN(constants.VERSION), masterPublicKey]))),
    // new Uint8Array(bytes.arrayify(bytes.combine([new BN('0x01'), masterPublicKey]))),
  );

  // Prefix exists, encode and return with prefix
  if (chainID && prefixes[chainID]) {
    return bech32.encode(prefixes[chainID], words);
  }

  // No chainID specified, throw error
  return bech32.encode('rgany', words);
}

function decode(address: string): AddressData {
  const decoded = bech32.decode(address);

  // Hexlify data
  const data = bytes.hexlify(bech32.fromWords(decoded.words));

  // Get version
  const version = parseInt(data.slice(0, 2), 16);
  const masterPublicKey = data.slice(2);

  // Throw if address version is not supported
  if (version !== constants.VERSION) throw new Error('Incorrect address version');

  const result: Partial<AddressData> = {
    masterPublicKey,
    version,
  };

  if (prefixes.includes(decoded.prefix)) {
    // If we know this prefix, then return with chainID
    result.chainID = prefixes.indexOf(decoded.prefix);
  }

  if (decoded.prefix === 'rgany') {
    // If this is the generic prefix, return undefined
    result.chainID = undefined;
  }

  if ('chainID' in result) return result as AddressData;

  // Don't know what this prefix is, throw
  throw new Error('Address prefix unrecognized');
}

export { encode, decode };
