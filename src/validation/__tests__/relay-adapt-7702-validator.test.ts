import { expect } from 'chai';
import { TRANSACTION_STRUCT_ABI, ACTION_DATA_STRUCT_ABI } from '../../transaction/relay-adapt-7702-signature';
import { ParamType } from 'ethers';

describe('RelayAdapt7702Validator', () => {
  it('should have valid ABI strings derived from TypeChain', () => {
    expect(TRANSACTION_STRUCT_ABI).to.be.a('string');
    
    expect(ACTION_DATA_STRUCT_ABI).to.be.a('string');

    // Verify they are valid ParamTypes
    const transactionType = ParamType.from(TRANSACTION_STRUCT_ABI);
    expect(transactionType.baseType).to.equal('tuple');
    
    const actionDataType = ParamType.from(ACTION_DATA_STRUCT_ABI);
    expect(actionDataType.baseType).to.equal('tuple');
  });
});
