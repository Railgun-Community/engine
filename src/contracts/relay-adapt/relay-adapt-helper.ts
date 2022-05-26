import { DepositInput } from '../../models/formatted-types';
import { ERC20Deposit } from '../../note';
import { Wallet } from '../../wallet';

class RelayAdaptHelper {
  static generateRelayDepositInputs(wallet: Wallet, random: string, depositTokens: string[]) {
    const relayDeposits = RelayAdaptHelper.createRelayDeposits(
      wallet.masterPublicKey,
      random,
      depositTokens,
    );
    const viewingPrivateKey = wallet.getViewingKeyPair().privateKey;
    return RelayAdaptHelper.createRelayDepositInputs(viewingPrivateKey, relayDeposits);
  }

  private static createRelayDeposits(
    masterPublicKey: bigint,
    random: string,
    tokens: string[],
  ): ERC20Deposit[] {
    return tokens.map((token) => {
      return new ERC20Deposit(masterPublicKey, random, 0n, token);
    });
  }

  private static createRelayDepositInputs(
    viewingPrivateKey: Uint8Array,
    relayDeposits: ERC20Deposit[],
  ): DepositInput[] {
    return relayDeposits.map((deposit) => {
      return deposit.serialize(viewingPrivateKey);
    });
  }
}

export { RelayAdaptHelper };
