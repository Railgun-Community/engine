import { HDNodeWallet } from 'ethers';

const EPHEMERAL_DERIVATION_PATH_PREFIX = "m/44'/60'/0'/7702";

/**
 * Derives an ephemeral wallet for RelayAdapt7702 transactions.
 * Uses path: m/44'/60'/0'/7702/index
 * @param mnemonic - User's mnemonic
 * @param index - Index for the ephemeral key (nonce)
 * @returns HDNodeWallet
 */
export const deriveEphemeralWallet = (mnemonic: string, index: number): HDNodeWallet => {
  const path = `${EPHEMERAL_DERIVATION_PATH_PREFIX}/${index}`;
  return HDNodeWallet.fromPhrase(mnemonic, undefined, path);
};
