// import BN from 'bn.js';
import { bech32m } from '@scure/base';
import xor from 'buffer-xor';
import { bytes, constants } from '../utils';
import {
  ByteLength,
  formatToByteLength,
  hexStringToBytes,
  hexToBigInt,
  nToHex,
  padToLength,
} from '../utils/bytes';

export type AddressData = {
  masterPublicKey: bigint;
  viewingPublicKey: Uint8Array;
  chainID?: number;
  version?: number;
};
export const ADDRESS_LENGTH_LIMIT = 127;
export const UNDEFINED_CHAIN = 'ffffffffffffffff';
const PREFIX = '0zk';

/**
 * @param {string} chainID - hex value of chainID
 * @returns {Buffer} - chainID XOR'd with 'railgun' to make address prettier
 */
const xorChainID = (chainID: string) =>
  xor(Buffer.from(chainID as string, 'hex'), Buffer.from('railgun', 'utf8')).toString('hex');

/**
 * Bech32 encodes address
 * @param pubkey - public key to encode
 * @param version - version
 * @param chainID - chainID to encode
 */
function encode(data: AddressData): string {
  const { chainID } = data;
  const masterPublicKey = nToHex(data.masterPublicKey, ByteLength.UINT_256, false);
  const viewingPublicKey = formatToByteLength(data.viewingPublicKey, ByteLength.UINT_256);

  const formattedChainID = chainID
    ? (padToLength(chainID.toString(16), 8) as string)
    : UNDEFINED_CHAIN;
  const networkID = xorChainID(formattedChainID);

  const version = '01';

  // Create 73 byte address buffer
  const addressBuffer = Buffer.from(
    `${version}${masterPublicKey}${networkID}${viewingPublicKey}`,
    'hex',
  );

  // Encode address
  const address = bech32m.encode(PREFIX, bech32m.toWords(addressBuffer), ADDRESS_LENGTH_LIMIT);

  return address;
}

function decode(address: string): AddressData {
  try {
    if (!address) {
      throw new Error('No address to decode');
    }

    const decoded = bech32m.decode(address, ADDRESS_LENGTH_LIMIT);

    if (decoded.prefix !== PREFIX) {
      throw new Error('Invalid address prefix');
    }

    // Hexlify data
    const data = bytes.hexlify(bech32m.fromWords(decoded.words));

    // Get version
    const version = parseInt(data.slice(0, 2), 16);
    const masterPublicKey = hexToBigInt(data.slice(2, 66));
    const networkID = xorChainID(data.slice(66, 82));
    const viewingPublicKey = hexStringToBytes(data.slice(82, 146));

    // return undefined if XORed network matches the value we use to indicate undefined chain
    const chainID = networkID === UNDEFINED_CHAIN ? undefined : parseInt(networkID, 16);

    // Throw if address version is not supported
    if (version !== constants.VERSION) throw new Error('Incorrect address version');

    const result: AddressData = {
      masterPublicKey,
      viewingPublicKey,
      version,
      chainID,
    };

    return result;
  } catch (err: any) {
    if (err.message && err.message.includes('Invalid checksum')) {
      throw new Error('Invalid checksum');
    }
    throw err;
  }
}

export { encode, decode };
