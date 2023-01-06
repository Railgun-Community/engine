// eslint-disable-next-line import/no-extraneous-dependencies
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Wallet } from 'ethers';
import { RailgunSmartWalletContract } from '../contracts/railgun-smart-wallet/railgun-smart-wallet';
import { Chain } from '../models/engine-types';
import { NFTTokenData, TokenType } from '../models/formatted-types';
import { ShieldNoteNFT } from '../note/nft/shield-note-nft';
import { TestERC721 } from '../typechain-types';
import { hexToBytes, randomHex } from '../utils/bytes';
import { RailgunWallet } from '../wallet/railgun-wallet';
import { awaitScan } from './helper.test';

chai.use(chaiAsPromised);
const { expect } = chai;

export const mintNFTsID01ForTest = async (nft: TestERC721, ethersWallet: Wallet) => {
  const nftBalanceBeforeMint = await nft.balanceOf(ethersWallet.address);
  expect(nftBalanceBeforeMint.toHexString()).to.equal('0x00');
  const mintTx0 = await nft.mint(ethersWallet.address, 0);
  await mintTx0.wait();
  const mintTx1 = await nft.mint(ethersWallet.address, 1);
  await mintTx1.wait();
  const nftBalanceAfterMint = await nft.balanceOf(ethersWallet.address);
  expect(nftBalanceAfterMint.toHexString()).to.equal('0x02');
  const tokenOwner = await nft.ownerOf(1);
  expect(tokenOwner).to.equal(ethersWallet.address);
  const tokenURI = await nft.tokenURI(1);
  expect(tokenURI).to.equal('');
};

export const shieldNFTForTest = async (
  wallet: RailgunWallet,
  ethersWallet: Wallet,
  railgunSmartWalletContract: RailgunSmartWalletContract,
  chain: Chain,
  random: string,
  nftAddress: string,
  tokenSubID: string,
): Promise<ShieldNoteNFT> => {
  // Create shield
  const nftTokenData: NFTTokenData = {
    tokenAddress: nftAddress,
    tokenType: TokenType.ERC721,
    tokenSubID,
  };
  const shield = new ShieldNoteNFT(wallet.masterPublicKey, random, 1n, nftTokenData);
  const shieldPrivateKey = hexToBytes(randomHex(32));
  const shieldInput = await shield.serialize(shieldPrivateKey, wallet.getViewingKeyPair().pubkey);

  const shieldTx = await railgunSmartWalletContract.generateShield([shieldInput]);

  const awaiterShield = awaitScan(wallet, chain);

  // Send shield on chain
  await (await ethersWallet.sendTransaction(shieldTx)).wait();

  // Wait for events to fire
  await new Promise((resolve) =>
    railgunSmartWalletContract.contract.once(
      railgunSmartWalletContract.contract.filters.Shield(),
      resolve,
    ),
  );

  await expect(awaiterShield).to.be.fulfilled;

  return shield;
};
