import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { TXO } from '../../models';
import { removeUndefineds } from '../../utils/is-defined';
import { POI } from '../poi';

chai.use(chaiAsPromised);
const { expect } = chai;

function makeTXO(overrides: Partial<TXO>): TXO {
    return {
        tree: 0,
        position: 0,
        txid: '',
        timestamp: undefined,
        blockNumber: 0,
        spendtxid: false,
        nullifier: '',
        note: {} as any,
        poisPerList: undefined,
        blindedCommitment: undefined,
        commitmentType: 0 as any,
        transactCreationRailgunTxid: undefined,
        ...overrides,
    } as TXO;
}

describe('poi-nullifier-collision', () => {
    it('Should filter spentTXOs by tree to avoid cross-tree nullifier collision', () => {
        // Scenario:
        // Same nullifier COLLISION exists in Tree 1 (old spend) and Tree 2 (new unshield)
        // Transaction used inputs from Tree 2 (utxoTreeIn = 2)

        const txoTree1 = makeTXO({ tree: 1, position: 0, nullifier: 'COLLISION', txid: '1000' });
        const txoTree2 = makeTXO({ tree: 2, position: 0, nullifier: 'COLLISION', txid: '2000' });
        const txoOther = makeTXO({ tree: 2, position: 1, nullifier: 'B', txid: '2000' });

        const result = POI.filterSpentTXOs(
            [txoTree1, txoTree2, txoOther],
            ['0xCOLLISION', '0xB'],
            2,
        );

        expect(result).to.have.lengthOf(2);
        expect(result[0]).to.equal(txoTree2);
        expect(result[1]).to.equal(txoOther);
    });

    it('Should order spentTXOs correctly when collision exists across trees', () => {
        // Scenario:
        // Nullifier COLLISION in Tree 1 (txid 1000) and Tree 2 (txid 2000)
        // Nullifier B only in Tree 2 (txid 2000)
        // Without tree scoping, find() returns Tree 1's TXO first (wrong)

        const txoTree1 = makeTXO({ tree: 1, position: 0, nullifier: 'COLLISION', txid: '1000' });
        const txoTree2 = makeTXO({ tree: 2, position: 0, nullifier: 'COLLISION', txid: '2000' });
        const txoB = makeTXO({ tree: 2, position: 1, nullifier: 'B', txid: '2000' });

        const nullifiers = ['0xCOLLISION', '0xB'];

        const spentTXOs = POI.filterSpentTXOs([txoTree1, txoTree2, txoB], nullifiers, 2);
        const orderedSpentTXOs: TXO[] = removeUndefineds(
            nullifiers.map((nullifier) =>
                spentTXOs.find((txo) => `0x${txo.nullifier}` === nullifier),
            ),
        );

        expect(orderedSpentTXOs).to.have.lengthOf(2);
        expect(orderedSpentTXOs[0]).to.equal(txoTree2);
        expect(orderedSpentTXOs[0].tree).to.equal(2);
        expect(orderedSpentTXOs[1]).to.equal(txoB);
    });

    it('Should work correctly when there is no collision', () => {
        // Scenario:
        // Nullifiers A, B only in Tree 2 — no collision

        const txoA = makeTXO({ tree: 2, position: 0, nullifier: 'A' });
        const txoB = makeTXO({ tree: 2, position: 1, nullifier: 'B' });

        const result = POI.filterSpentTXOs([txoA, txoB], ['0xA', '0xB'], 2);

        expect(result).to.have.lengthOf(2);
        expect(result[0]).to.equal(txoA);
        expect(result[1]).to.equal(txoB);
    });
});
