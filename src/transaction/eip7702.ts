import { HDNodeWallet, Wallet, keccak256, encodeRlp, getBytes, toBeHex } from 'ethers';
import { EIP7702Authorization } from '../models/relay-adapt-types';

function toRlpInteger(value: number): string | Uint8Array {
  if (value === 0) {
    return new Uint8Array(0);
  }
  return toBeHex(value);
}

/**
 * Signs an EIP-7702 Authorization Tuple.
 * Payload: 0x05 || rlp([chain_id, address, nonce])
 * @param signer - The ephemeral key signer
 * @param contractAddress - The address to delegate to (RelayAdapt7702)
 * @param chainId - Chain ID
 * @param nonce - Nonce (default 0)
 * @returns EIP7702Authorization
 */
export const signEIP7702Authorization = (
  signer: HDNodeWallet | Wallet,
  contractAddress: string,
  chainId: number,
  nonce: number = 0
): EIP7702Authorization => {
  // RLP encode the tuple [chain_id, address, nonce]
  // We use toRlpInteger to ensure numbers are formatted correctly for RLP (0 -> empty bytes, others -> hex)
  const rlpEncoded = encodeRlp([
    toRlpInteger(chainId),
    contractAddress,
    toRlpInteger(nonce)
  ]);

  // Prepend 0x05 (EIP-7702 transaction type / magic byte)
  const payload = new Uint8Array([0x05, ...getBytes(rlpEncoded)]);
  const hash = keccak256(payload);

  // Sign the hash directly (not EIP-191)
  const sig = signer.signingKey.sign(hash);

  return {
    chainId: chainId.toString(),
    address: contractAddress,
    nonce,
    yParity: sig.yParity,
    r: sig.r,
    s: sig.s,
  };
};
