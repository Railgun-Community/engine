// eslint-disable-next-line import/no-extraneous-dependencies
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Wallet } from 'ethers';
import { RailgunSmartWalletContract } from '../contracts/railgun-smart-wallet/railgun-smart-wallet';
import { Chain } from '../models/engine-types';
import { NFTTokenData, TokenType } from '../models/formatted-types';
import { ShieldNoteNFT } from '../note/nft/shield-note-nft';
import { hexToBytes, randomHex } from '../utils/bytes';
import { RailgunWallet } from '../wallet/railgun-wallet';
import {
  awaitRailgunSmartWalletShield,
  awaitScan,
  sendTransactionWithLatestNonce,
} from './helper.test';
import { TestERC721 } from './abi/typechain/TestERC721';
import { promiseTimeout } from '../utils/promises';

chai.use(chaiAsPromised);
const { expect } = chai;

export const mintNFTsID01ForTest = async (nft: TestERC721, ethersWallet: Wallet) => {
  const nftBalanceBeforeMint = await nft.balanceOf(ethersWallet.address);
  expect(nftBalanceBeforeMint).to.equal(0n);
  const mintTx0 = await nft.mint.populateTransaction(ethersWallet.address, 0);
  const mintTx0Send = await sendTransactionWithLatestNonce(ethersWallet, mintTx0);
  await mintTx0Send.wait();
  const mintTx1 = await nft.mint.populateTransaction(ethersWallet.address, 1);
  const mintTx1Send = await sendTransactionWithLatestNonce(ethersWallet, mintTx1);
  await mintTx1Send.wait();
  const nftBalanceAfterMint = await nft.balanceOf(ethersWallet.address);
  expect(nftBalanceAfterMint).to.equal(2n);
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

  // Send shield on chain
  const txResponse = await sendTransactionWithLatestNonce(ethersWallet, shieldTx);

  await Promise.all([
    awaitRailgunSmartWalletShield(railgunSmartWalletContract),
    promiseTimeout(awaitScan(wallet, chain), 10000, 'Timed out waiting for NFT shield'),
    txResponse.wait(),
  ]);
  await wallet.refreshPOIsForAllTXIDVersions(chain, true);

  return shield;
};
