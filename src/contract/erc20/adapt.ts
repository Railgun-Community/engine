import { Contract, PopulatedTransaction, BigNumber} from 'ethers';
import type { Provider } from '@ethersproject/abstract-provider';
import { bytes} from '../../utils';
import {
  ERC20TransactionSerialized,
} from '../../transaction/erc20';
import { abi } from './abi';
import { LeptonDebugger } from '../../models/types';
import { ByteLength, BytesData, formatToByteLength, hexlify } from '../../utils/bytes';

export type Call = {
  to: bytes.BytesData;
  data: bytes.BytesData;
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
  wrapAllETH(transactions: ERC20TransactionSerialized[], random: BigNumber, requireSucccess: String, _calls: Call[]): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.relay(transactions,random,requireSucccess,_calls);
  }

/**
  *                          
  * @param
  * @returns
  */
  unwrapAllWETH(transactions: ERC20TransactionSerialized[], random: BigNumber, requireSucccess: String, _calls: Call[]): Promise<PopulatedTransaction> {
    return this.contract.populateTransaction.relay(transactions,random,requireSucccess,_calls);
  }

  /**
   * Remove all listeners and shutdown contract instance
   */
  unload() {
    this.contract.removeAllListeners();
  }
}

export {adapt}