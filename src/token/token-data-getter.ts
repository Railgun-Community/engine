import { TokenDataStructOutput } from '../abi/typechain/RailgunSmartWallet';
import { ContractStore } from '../contracts/contract-store';
import { RailgunSmartWalletContract } from '../contracts/railgun-smart-wallet/railgun-smart-wallet';
import { Database } from '../database/database';
import { Chain } from '../models/engine-types';
import { TokenData } from '../models/formatted-types';
import { getTokenDataERC20, serializeTokenData } from '../note/note-util';
import { ByteLength, formatToByteLength, fromUTF8String } from '../utils';

// 12 empty bytes.
const ERC20_TOKEN_HASH_PREFIX = '000000000000000000000000';

export class TokenDataGetter {
  private db: Database;

  private railgunSmartWalletContract: RailgunSmartWalletContract;

  constructor(db: Database, chain: Chain) {
    this.db = db;
    this.railgunSmartWalletContract = ContractStore.getRailgunSmartWalletContract(chain);
  }

  async getTokenDataFromHash(tokenHash: string): Promise<TokenData> {
    const formatted = formatToByteLength(tokenHash, ByteLength.UINT_256);
    const isERC20 = formatted.startsWith(ERC20_TOKEN_HASH_PREFIX);
    if (isERC20) {
      // tokenHash is erc20 tokenAddress.
      return getTokenDataERC20(tokenHash);
    }
    const tokenDataNFT = await this.getNFTTokenData(tokenHash);
    return tokenDataNFT;
  }

  async getNFTTokenData(tokenHash: string): Promise<TokenData> {
    const formattedTokenHash = formatToByteLength(tokenHash, ByteLength.UINT_256, false);

    const cachedData = await this.getCachedNFTTokenData(formattedTokenHash);
    if (cachedData) {
      return cachedData;
    }

    const contractData = await this.railgunSmartWalletContract.getNFTTokenData(formattedTokenHash);
    const tokenData = TokenDataGetter.structToTokenData(contractData);
    await this.cacheNFTTokenData(tokenHash, tokenData);
    return tokenData;
  }

  private static structToTokenData(struct: TokenDataStructOutput): TokenData {
    return serializeTokenData(struct.tokenAddress, struct.tokenType, struct.tokenSubID);
  }

  private static getNFTTokenDataPrefix(): string[] {
    const nftTokenDataPrefix = fromUTF8String('nft-token-data-map');
    return [nftTokenDataPrefix];
  }

  private static getNFTTokenDataPath(tokenHash: string): string[] {
    return [...TokenDataGetter.getNFTTokenDataPrefix(), tokenHash].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  private async cacheNFTTokenData(tokenHash: string, tokenData: TokenData): Promise<void> {
    await this.db.put(TokenDataGetter.getNFTTokenDataPath(tokenHash), tokenData, 'json');
  }

  async getCachedNFTTokenData(tokenHash: string): Promise<Optional<TokenData>> {
    try {
      const tokenData = (await this.db.get(
        TokenDataGetter.getNFTTokenDataPath(tokenHash),
        'json',
      )) as TokenData;
      return tokenData;
    } catch (err) {
      if (!(err instanceof Error)) {
        throw err;
      }
      return undefined;
    }
  }
}
