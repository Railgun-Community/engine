import { expect } from 'chai';
import { Provider } from 'ethers';
import { RelayAdapt7702Contract } from '../V2/relay-adapt-7702';
import { RelayAdapt7702ExecutionType } from '../../../transaction/relay-adapt-7702-signature';
import { RelayAdapt7702__factory } from '../../../abi/typechain/factories/RelayAdapt7702__factory';
import { ByteUtils } from '../../../utils/bytes';

const RELAY_ADAPT_7702_ADDRESS = '0x5bf5b11053e734690269C6B9D438F8C9d48F528A';
const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD';
const DUMMY_SIGNATURE = `0x${'11'.repeat(65)}`;

// Engine-side proof of the execute-nonce binding fix. The on-chain leg (that the contract
// accepts the signature) still needs the Hardhat suite, but the bug was engine-side: the
// populate path used to re-read the live nonce regardless of what was signed. These tests
// run with a dummy provider, so if getExecuteNonce (a live read) were called they would
// throw — proving the supplied executeNonce is used and the live read is bypassed.
describe('relay-adapt-7702 execute-nonce binding', () => {
  const buildContract = () =>
    new RelayAdapt7702Contract(
      RELAY_ADAPT_7702_ADDRESS,
      undefined as unknown as Provider,
      RelayAdapt7702ExecutionType.ExecuteWithNonce,
    );

  const decodeExecuteNonce = (data: string): bigint => {
    const decoded = RelayAdapt7702__factory.createInterface().parseTransaction({ data });
    expect(decoded?.name).to.equal('execute');
    // eslint-disable-next-line no-underscore-dangle
    return decoded?.args._nonce as bigint;
  };

  it('encodes the supplied execute nonce on the unshield base-token path (no live read)', async () => {
    const executeNonce = 7n;
    const populated = await buildContract().populateUnshieldBaseToken(
      [], // transactions
      DEAD_ADDRESS, // unshieldAddress
      ByteUtils.randomHex(31),
      false, // useDummyProof
      false, // sendWithPublicWallet
      undefined, // authorization
      DUMMY_SIGNATURE,
      DEAD_ADDRESS, // ephemeralAddress
      executeNonce,
    );
    expect(decodeExecuteNonce(populated.data ?? '')).to.equal(executeNonce);
  });

  it('encodes the supplied execute nonce on the cross-contract-calls path (no live read)', async () => {
    const executeNonce = 9n;
    const populated = await buildContract().populateCrossContractCalls(
      [], // unshieldTransactions
      [], // crossContractCalls
      [], // relayShieldRequests
      ByteUtils.randomHex(31),
      false, // isGasEstimate
      true, // isBroadcasterTransaction
      undefined, // minGasLimit
      undefined, // authorization
      DUMMY_SIGNATURE,
      DEAD_ADDRESS, // ephemeralAddress
      executeNonce,
    );
    expect(decodeExecuteNonce(populated.data ?? '')).to.equal(executeNonce);
  });
});
