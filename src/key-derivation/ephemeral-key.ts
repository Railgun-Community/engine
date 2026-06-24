import { HDNodeWallet } from 'ethers';

const EPHEMERAL_DERIVATION_PATH_PREFIX = "m/44'/60'/0'/7702";

// BIP-32 hardened path segments must be below 2^31.
const HARDENED_INDEX_LIMIT = 0x80000000n;

export const getEphemeralWalletBasePath = (
  railgunIndex: number,
  chainId: bigint,
): string => {
  if (
    !Number.isInteger(railgunIndex) ||
    railgunIndex < 0 ||
    BigInt(railgunIndex) >= HARDENED_INDEX_LIMIT
  ) {
    throw new Error(
      `Cannot derive ephemeral 7702 wallet: railgunIndex ${railgunIndex} is out of range for a hardened BIP-32 segment (0 to 2^31 - 1).`,
    );
  }
  if (chainId < 0n || chainId >= HARDENED_INDEX_LIMIT) {
    throw new Error(
      `Cannot derive ephemeral 7702 wallet: chainId ${chainId} exceeds the hardened BIP-32 segment limit (2^31). RelayAdapt7702 ephemeral keys are unsupported on this chain.`,
    );
  }
  return `${EPHEMERAL_DERIVATION_PATH_PREFIX}'/${railgunIndex}'/${chainId.toString(10)}'`;
};

export const getEphemeralWalletPathSuffix = (
  index: number,
): string => {
  if (!Number.isInteger(index) || index < 0 || BigInt(index) >= HARDENED_INDEX_LIMIT) {
    throw new Error(
      `Cannot derive ephemeral 7702 wallet: index ${index} is out of range for a hardened BIP-32 segment (0 to 2^31 - 1).`,
    );
  }
  return `${index}'`;
};

const normalizeEphemeralWalletPathSuffix = (pathSuffix: string): string => {
  const normalizedPathSuffix = pathSuffix.trim().replace(/^\/+|\/+$/g, '');

  if (normalizedPathSuffix.length === 0) {
    throw new Error('Invalid ephemeral wallet derivation path suffix.');
  }

  if (normalizedPathSuffix.startsWith("m/")) {
    throw new Error('Ephemeral wallet derivation path suffix must be relative.');
  }

  const pathSegments = normalizedPathSuffix.split('/');
  if (pathSegments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error('Invalid ephemeral wallet derivation path suffix.');
  }

  return normalizedPathSuffix;
};

export const deriveEphemeralWalletFromPathSuffix = (
  mnemonic: string,
  basePath: string,
  pathSuffix: string,
): HDNodeWallet => {
  const normalizedPathSuffix = normalizeEphemeralWalletPathSuffix(pathSuffix);
  const normalizedBasePath = basePath.replace(/\/+$/g, '');
  const path = `${normalizedBasePath}/${normalizedPathSuffix}`;
  return HDNodeWallet.fromPhrase(mnemonic, undefined, path);
};

/**
 * Derives an ephemeral wallet for RelayAdapt7702 transactions.
 * Uses path: m/44'/60'/0'/7702'/railgunIndex'/chainId'/index'
 * @param mnemonic - User's mnemonic
 * @param railgunIndex - Base RAILGUN wallet derivation index
 * @param chainId - Chain ID for the ephemeral key
 * @param index - Index for the ephemeral key (nonce)
 * @returns HDNodeWallet
 */
export const deriveEphemeralWallet = (
  mnemonic: string,
  railgunIndex: number,
  chainId: bigint,
  index: number,
): HDNodeWallet => {
  const basePath = getEphemeralWalletBasePath(railgunIndex, chainId);
  const pathSuffix = getEphemeralWalletPathSuffix(index);
  return deriveEphemeralWalletFromPathSuffix(mnemonic, basePath, pathSuffix);
};
