import { TokenType } from '../../models';
import { getTokenDataNFT, ERC721_NOTE_VALUE } from '../note-util';
import { ShieldNote } from '../shield-note';

export class ShieldNoteNFT extends ShieldNote {
  constructor(
    masterPublicKey: bigint,
    random: string,
    nftAddress: string,
    tokenType: TokenType.ERC721 | TokenType.ERC1155,
    tokenSubID: string,
  ) {
    const tokenData = getTokenDataNFT(nftAddress, tokenType, tokenSubID);
    super(masterPublicKey, random, ERC721_NOTE_VALUE, tokenData);
  }
}
