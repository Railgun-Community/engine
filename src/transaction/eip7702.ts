import { HDNodeWallet, Wallet, Authorization } from 'ethers';

/**
 * Signs an EIP-7702 Authorization Tuple using ethers native methods.
 * @param signer - The ephemeral key signer
 * @param contractAddress - The address to delegate to (RelayAdapt7702)
 * @param chainId - Chain ID (optional - will be auto-populated if not provided)
 * @param nonce - Nonce (optional - will be auto-populated if not provided)
 * @returns Authorization
 */
export const signEIP7702Authorization = async (
  signer: HDNodeWallet | Wallet,
  contractAddress: string,
  chainId?: bigint,
  nonce?: number,
): Promise<Authorization> => {
  // Use ethers 6.14.3+ native 7702 authorization signing
  const authRequest = await signer.populateAuthorization({
    address: contractAddress,
    ...(chainId !== undefined && { chainId }),
    ...(nonce !== undefined && { nonce: BigInt(nonce) }),
  });
  
  return signer.authorize(authRequest);
};


