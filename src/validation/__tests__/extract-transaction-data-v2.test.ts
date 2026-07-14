import { expect } from 'chai';
import Sinon from 'sinon';
import { ChainType } from '../../models/engine-types';
import EngineDebug from '../../debugger/debugger';
import { validateRelayAdapt7702ExecutionSignatureAdvisory } from '../extract-transaction-data-v2';

describe('extract-transaction-data-v2 advisory 7702 execution-signature check', () => {
  const chain = { type: ChainType.EVM, id: 1 };
  const expectedSigner = '0x1111111111111111111111111111111111111111';
  const actionData = { requireSuccess: true, minGasLimit: 0n, calls: [] };

  afterEach(() => {
    Sinon.restore();
  });

  it('does not reject (only logs) when the execution signature is invalid', () => {
    const debugStub = Sinon.stub(EngineDebug, 'error');
    const args = {
      _transactions: [],
      _actionData: actionData,
      _nonce: 5n,
      _signature: `0x${'11'.repeat(65)}`, // invalid signature
    };

    // Advisory only: must never throw, even though validation fails.
    expect(() =>
      validateRelayAdapt7702ExecutionSignatureAdvisory(chain, expectedSigner, args),
    ).to.not.throw();
    // It attempted validation and surfaced the failure as a log, not a rejection.
    expect(debugStub.calledOnce).to.equal(true);
  });

  it('skips silently when there is no real signature (gas estimate)', () => {
    const debugStub = Sinon.stub(EngineDebug, 'error');
    const args = {
      _transactions: [],
      _actionData: actionData,
      _nonce: 5n,
      _signature: '0x',
    };

    expect(() =>
      validateRelayAdapt7702ExecutionSignatureAdvisory(chain, expectedSigner, args),
    ).to.not.throw();
    expect(debugStub.called).to.equal(false);
  });
});
