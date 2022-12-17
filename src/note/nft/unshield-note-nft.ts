import { TokenType } from '../../models';
import { getTokenDataNFT, ERC721_NOTE_VALUE } from '../note-util';
import { UnshieldNote } from '../unshield-note';

export class UnshieldNoteNFT extends UnshieldNote {
  constructor(
    toAddress: string,
    nftAddress: string,
    tokenType: TokenType.ERC721 | TokenType.ERC1155,
    tokenSubID: string,
    allowOverride: boolean = false,
  ) {
    const tokenData = getTokenDataNFT(nftAddress, tokenType, tokenSubID);
    super(toAddress, ERC721_NOTE_VALUE, tokenData, allowOverride);
  }
}
