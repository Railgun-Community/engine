import { Contract, PopulatedTransaction, BigNumber, ethers} from 'ethers';
import type { Provider } from '@ethersproject/abstract-provider';
import { bytes} from '../../utils';
import {
  ERC20TransactionSerialized,
} from '../../transaction/erc20';
import { abi } from './abi';
import { LeptonDebugger } from '../../models/types';
import {BytesData} from '../../utils/bytes';

export type Call = {
  to: BytesData;
  data: BytesData;
  value: BigNumber;
}

class adapt {
  contract: Contract;

  // Contract address
  address: string;
  
  readonly leptonDebugger: LeptonDebugger | undefined;
  
  /**
  * Connect to Railgun instance on network
  * @param address - address of Railgun instance (Proxy contract)
  * @param provider - Network provider
  */
  constructor(address: string, provider: Provider, leptonDebugger?: LeptonDebugger) {
    this.address = address;
    this.contract = new Contract(address, abi, provider);
    this.leptonDebugger = leptonDebugger;
  }  

  /**
  *                          
  * @param
  * @returns
  */
  wrapAllETH(transactions: ERC20TransactionSerialized[], random: BigNumber, requireSucccess: String, _amount: BigNumber, _to: bytes.BytesData, _data:bytes.BytesData): Promise<PopulatedTransaction> {
    const abiCoder = ethers.utils.defaultAbiCoder;
    const _call: Call = {
      to: _to,
      data: abiCoder.encode(["BytesData"], [_data]),
      value: _amount
    };
    
    abiCoder.encode(["BytesData"], [_call]);
    
    return this.contract.populateTransaction.relay(transactions,random,requireSucccess,_call);
  }

/**
  *                          
  * @param
  * @returns
  */
  unwrapAllWETH(transactions: ERC20TransactionSerialized[], random: BigNumber, requireSucccess: String, _amount: BigNumber, _to: bytes.BytesData, _data:bytes.BytesData): Promise<PopulatedTransaction> {
    const abiCoder = ethers.utils.defaultAbiCoder;

    const _call: Call = {
      to: _to,
      data: abiCoder.encode(["BytesData"], [_data]),
      value: _amount
    };
    
    abiCoder.encode(["BytesData"], [_call]);
        
    return this.contract.populateTransaction.relay(transactions,random,requireSucccess,_call);
  }

}

export {adapt}