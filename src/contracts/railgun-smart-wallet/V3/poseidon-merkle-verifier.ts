import {
  AbiCoder,
  Contract,
  ContractTransaction,
  FallbackProvider,
  Interface,
  Log,
  Provider,
  Result,
  TransactionRequest,
  toUtf8String,
} from 'ethers';
import { PollingJsonRpcProvider } from '../../../provider/polling-json-rpc-provider';
import { PoseidonMerkleVerifier } from '../../../abi/typechain/PoseidonMerkleVerifier';
import { ABIPoseidonMerkleVerifier, ABIRelayAdapt } from '../../../abi/abi';
import { ShieldCiphertextStruct } from '../../../abi/typechain/RailgunSmartWallet';
import { TransactionStructV3 } from '../../../models/transaction-types';
import EngineDebug from '../../../debugger/debugger';
import { TransactionReceiptLog } from '../../../models/formatted-types';

enum RelayAdaptEvent {
  CallError = 'CallError',
}

export const RETURN_DATA_RELAY_ADAPT_STRING_PREFIX = '0x5c0dee5d';
export const RETURN_DATA_STRING_PREFIX = '0x08c379a0';

export class PoseidonMerkleVerifierContract {
  readonly contract: PoseidonMerkleVerifier;

  readonly address: string;

  constructor(address: string, provider: PollingJsonRpcProvider | FallbackProvider) {
    this.address = address;
    this.contract = new Contract(
      address,
      ABIPoseidonMerkleVerifier,
      provider,
    ) as unknown as PoseidonMerkleVerifier;
  }

  generateExecute(
    transactions: PoseidonMerkleVerifier.TransactionStruct[],
    shields: PoseidonMerkleVerifier.ShieldRequestStruct[],
    globalBoundParams: PoseidonMerkleVerifier.GlobalBoundParamsStruct,
    unshieldChangeCiphertext: ShieldCiphertextStruct,
  ): Promise<ContractTransaction> {
    return this.contract.execute.populateTransaction(
      transactions,
      shields,
      globalBoundParams,
      unshieldChangeCiphertext,
    );
  }

  // eslint-disable-next-line class-methods-use-this
  async populateShieldBaseToken(
    shieldRequest: PoseidonMerkleVerifier.ShieldRequestStruct,
  ): Promise<ContractTransaction> {
    throw new Error('Not implemented: populateShieldBaseToken for V3 Verifier.');
  }

  // eslint-disable-next-line class-methods-use-this
  async populateUnshieldBaseToken(
    transactions: TransactionStructV3[],
    unshieldAddress: string,
  ): Promise<ContractTransaction> {
    throw new Error('Not implemented: populateUnshieldBaseToken for V3 Verifier.');
  }

  static async estimateGasWithErrorHandler(
    provider: Provider,
    transaction: ContractTransaction | TransactionRequest,
  ): Promise<bigint> {
    try {
      const gasEstimate = await provider.estimateGas(transaction);
      return gasEstimate;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      const { callFailedIndexString, errorMessage } =
        PoseidonMerkleVerifierContract.extractGasEstimateCallFailedIndexAndErrorText(err.message);
      throw new Error(
        `RelayAdapt multicall failed at index ${callFailedIndexString} with ${errorMessage}`,
      );
    }
  }

  static extractGasEstimateCallFailedIndexAndErrorText(errMessage: string) {
    try {
      // Sample error text from ethers v6.4.0: 'execution reverted (unknown custom error) (action="estimateGas", data="0x5c0dee5d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000", reason=null, transaction={ "data": "0x28223a77000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000007a00000000000000000000000000000000000000000000000000…00000000004640cd6086ade3e984b011b4e8c7cab9369b90499ab88222e673ec1ae4d2c3bf78ae96e95f9171653e5b1410273269edd64a0ab792a5d355093caa9cb92406125c7803a48028503783f2ab5e84f0ea270ce770860e436b77c942ed904a5d577d021cf0fd936183e0298175679d63d73902e116484e10c7b558d4dc84e113380500000000000000000000000000000000000000000000000000000000", "from": "0x000000000000000000000000000000000000dEaD", "to": "0x0355B7B8cb128fA5692729Ab3AAa199C1753f726" }, invocation=null, revert=null, code=CALL_EXCEPTION, version=6.4.0)'
      const prefixSplit = ` (action="estimateGas", data="`;
      const splitResult = errMessage.split(prefixSplit);
      const callFailedMessage = splitResult[0]; // execution reverted (unknown custom error)
      const dataMessage = splitResult[1].split(`"`)[0]; // 0x5c0dee5d000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000000
      const parsedDataMessage = this.parseRelayAdaptReturnValue(dataMessage);
      const callFailedIndexString: string = parsedDataMessage?.callIndex?.toString() ?? 'UNKNOWN';
      return {
        callFailedIndexString,
        errorMessage: `'${callFailedMessage}': ${parsedDataMessage?.error ?? dataMessage}`,
      };
    } catch (err) {
      return {
        callFailedIndexString: 'UNKNOWN',
        errorMessage: `error: ${errMessage}`,
      };
    }
  }

  private static getCallErrorTopic() {
    const iface = new Interface(ABIRelayAdapt);
    return iface.encodeFilterTopics(RelayAdaptEvent.CallError, [])[0];
  }

  static getRelayAdaptCallError(
    receiptLogs: TransactionReceiptLog[] | readonly Log[],
  ): Optional<string> {
    const topic = this.getCallErrorTopic();
    try {
      // eslint-disable-next-line no-restricted-syntax
      for (const log of receiptLogs) {
        if (log.topics[0] === topic) {
          const parsed = this.customRelayAdaptErrorParse(log.data);
          if (parsed) {
            return parsed.error;
          }
        }
      }
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      EngineDebug.error(err);
      throw new Error(`Relay Adapt log parsing error: ${err.message}.`);
    }
    return undefined;
  }

  static parseRelayAdaptReturnValue(
    returnValue: string,
  ): Optional<{ callIndex?: number; error: string }> {
    if (returnValue.match(RETURN_DATA_RELAY_ADAPT_STRING_PREFIX)) {
      const strippedReturnValue = returnValue.replace(RETURN_DATA_RELAY_ADAPT_STRING_PREFIX, '0x');
      return this.customRelayAdaptErrorParse(strippedReturnValue);
    }
    if (returnValue.match(RETURN_DATA_STRING_PREFIX)) {
      return { error: this.parseRelayAdaptStringError(returnValue) };
    }
    return {
      error: `Not a RelayAdapt return value: must be prefixed with ${RETURN_DATA_RELAY_ADAPT_STRING_PREFIX} or ${RETURN_DATA_STRING_PREFIX}`,
    };
  }

  private static customRelayAdaptErrorParse(
    data: string,
  ): Optional<{ callIndex: number; error: string }> {
    // Force parse as bytes
    const decoded: Result = AbiCoder.defaultAbiCoder().decode(
      ['uint256 callIndex', 'bytes revertReason'],
      data,
    );

    const callIndex = Number(decoded[0]);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const revertReasonBytes: string = decoded[1];

    // Map function to try parsing bytes as string
    const error = this.parseRelayAdaptStringError(revertReasonBytes);
    return { callIndex, error };
  }

  private static parseRelayAdaptStringError(revertReason: string): string {
    if (revertReason.match(RETURN_DATA_STRING_PREFIX)) {
      const strippedReturnValue = revertReason.replace(RETURN_DATA_STRING_PREFIX, '0x');
      const result = AbiCoder.defaultAbiCoder().decode(['string'], strippedReturnValue);
      return result[0];
    }
    try {
      const utf8 = toUtf8String(revertReason);
      if (utf8.length === 0) {
        throw new Error('No utf8 string parsed from revert reason.');
      }
      return utf8;
    } catch (err) {
      return `Unknown Relay Adapt error.`;
    }
  }
}
