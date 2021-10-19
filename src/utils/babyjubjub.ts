// @ts-ignore
import { babyJub, eddsa } from 'circomlib';
import hash from './hash';

/**
 * Converts 32 byte seed to babyjubjub point
 * @param seed - 32 byte seed to convert to babyjubjub point
 */
function seedToPoint(seed: BytesData): string {
  // TODO: clarify this explanation and remove dependance on circomlib
  // https://tools.ietf.org/html/rfc8032
  // Because of the 'buff[0] & 0xF8' part which makes sure you have a point
  // with order that 8 divides (^ pruneBuffer)
  // Every point in babyjubjub is of the form: aP + bH, where H has order 8
  // and P has a big large prime order
  // Guaranteeing that any low order points in babyjubjub get deleted
  const sBuff = eddsa.pruneBuffer(bigInt2Buffer(poseidon([seed])).slice(0, 32));

}

export default {
  seedToPoint,
};
