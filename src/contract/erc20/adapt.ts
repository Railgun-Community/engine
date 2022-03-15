import { Contract, PopulatedTransaction, BigNumber, ethers, Overrides, PayableOverrides, CallOverrides} from 'ethers';
import type { Provider } from '@ethersproject/abstract-provider';
import { bytes} from '../../utils';
import {
  ERC20TransactionSerialized,
} from '../../transaction/erc20';
import { abi } from './abi';
import { LeptonDebugger } from '../../models/types';
import {BytesData} from '../../utils/bytes';

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
  relay(transactions: ERC20TransactionSerialized[], random: BigNumber, requireSucccess: Boolean, calls:PopulatedTransaction[], overrides?: CallOverrides): Promise<PopulatedTransaction> {

    return this.contract.populateTransaction.relay(transactions,random,requireSucccess,calls.map((call) => {
      if (!call.to) {
        throw new Error('Must specify to address');
      }
    
      return {
        to: call.to,
        data: call.data || '',
        value: call.value || '0'
      }
    }), overrides);
  }

  /**
  * ERC20TransactionSerialized proof fields should be set to '0'
  */
  estimateGas(transactions: ERC20TransactionSerialized[], random: BigNumber, requireSucccess: Boolean, calls:PopulatedTransaction[], overrides?: CallOverrides): Promise<BigNumber> {

    const overridesFormatted = overrides || {}
    overridesFormatted.from = "0x0000000000000000000000000000000000000000";
    
    return this.contract.estimateGas.relay(transactions,random,requireSucccess,calls.map((call) => {
      if (!call.to) {
        throw new Error('Must specify to address');
      }
    
      return {
        to: call.to,
        data: call.data || '',
        value: call.value || '0'
      }
    }), overridesFormatted);
  }

  depositEth(amount:BigNumber, random:BigNumber, wethAddress: String, pubKey: String[]): Promise<PopulatedTransaction> {

    const calls = [this.contract.interface.encodeFunctionData("wrapAllEth"), 
    this.contract.interface.encodeFunctionData("deposit", [[wethAddress], random, pubKey])];
    
    return this.relay([], random, true, calls.map((call) => {
      return {
        to: this.contract.address,
        data: call,
      }
    }), {value : amount});
  }

  withdrawEth(transactions: ERC20TransactionSerialized[], random:BigNumber, to:String): Promise<PopulatedTransaction> {

    const calls = [this.contract.interface.encodeFunctionData("unWrapEth"), 
    this.contract.interface.encodeFunctionData("send", [["0x0000000000000000000000000000000000000000"], to])];
    
    return this.relay([], random, true, calls.map((call) => {
      return {
        to: this.contract.address,
        data: call,
      }
    }));
  }


}
export {adapt}