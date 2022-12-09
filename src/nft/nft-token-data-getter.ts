import { RailgunSmartWalletContract } from '../contracts';
import { Database } from '../database/database';
import { TokenData } from '../models';
import { serializeTokenData } from '../note';
import { TokenDataStructOutput } from '../typechain-types/contracts/logic/RailgunLogic';
import { ByteLength, formatToByteLength, fromUTF8String } from '../utils';

export class NFTTokenDataGetter {
  private db: Database;

  private railgunSmartWalletContract: RailgunSmartWalletContract;

  constructor(db: Database, railgunSmartWalletContract: RailgunSmartWalletContract) {
    this.db = db;
    this.railgunSmartWalletContract = railgunSmartWalletContract;
  }

  async getNFTTokenData(tokenHash: string): Promise<TokenData> {
    const formattedTokenHash = formatToByteLength(tokenHash, ByteLength.UINT_256, false);

    const cachedData = await this.getCachedNFTTokenData(formattedTokenHash);
    if (cachedData) {
      return cachedData;
    }

    const contractData = await this.railgunSmartWalletContract.getNFTTokenData(formattedTokenHash);
    const tokenData = NFTTokenDataGetter.structToTokenData(contractData);
    await this.cacheNFTTokenData(tokenHash, tokenData);
    return tokenData;
  }

  private static structToTokenData(struct: TokenDataStructOutput): TokenData {
    return serializeTokenData(
      struct.tokenAddress,
      struct.tokenType,
      struct.tokenSubID.toHexString(),
    );
  }

  private static getNFTTokenDataPrefix(): string[] {
    const nftTokenDataPrefix = fromUTF8String('nft-token-data-map');
    return [nftTokenDataPrefix];
  }

  private static getNFTTokenDataPath(tokenHash: string): string[] {
    return [...NFTTokenDataGetter.getNFTTokenDataPrefix(), tokenHash].map((el) =>
      formatToByteLength(el, ByteLength.UINT_256),
    );
  }

  private async cacheNFTTokenData(tokenHash: string, tokenData: TokenData): Promise<void> {
    await this.db.put(NFTTokenDataGetter.getNFTTokenDataPath(tokenHash), tokenData, 'json');
  }

  async getCachedNFTTokenData(tokenHash: string): Promise<Optional<TokenData>> {
    try {
      const tokenData = (await this.db.get(
        NFTTokenDataGetter.getNFTTokenDataPath(tokenHash),
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
