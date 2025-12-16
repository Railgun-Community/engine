import { expect } from 'chai';
import { Wallet, recoverAddress, keccak256, encodeRlp, getBytes, toBeHex } from 'ethers';
import { signEIP7702Authorization } from '../eip7702';

function toRlpInteger(value: number): string | Uint8Array {
  if (value === 0) {
    return new Uint8Array(0);
  }
  return toBeHex(value);
}

describe('EIP-7702 Signing', () => {
  it('should sign and recover correctly', () => {
    const signer = Wallet.createRandom();
    const contractAddress = '0x1234567890123456789012345678901234567890';
    const chainId = 1;
    const nonce = 0;

    const auth = signEIP7702Authorization(signer, contractAddress, chainId, nonce);

    // Reconstruct hash
    const rlpEncoded = encodeRlp([
      toRlpInteger(chainId),
      contractAddress,
      toRlpInteger(nonce)
    ]);
    const payload = new Uint8Array([0x05, ...getBytes(rlpEncoded)]);
    const hash = keccak256(payload);

    const recovered = recoverAddress(hash, {
      r: auth.r,
      s: auth.s,
      yParity: auth.yParity,
    });

    expect(recovered).to.equal(signer.address);
  });
});
