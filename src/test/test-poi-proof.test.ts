/* eslint-disable @typescript-eslint/no-unused-vars */
import { createDummyMerkleProof } from '../merkletree/merkle-proof';
import { POIEngineProofInputs, POIEngineProofInputsWithListPOIData } from '../models';

export const MOCK_LIST_KEY = 'test_list';

export const getDummyPOIProofInputs = (
  proofInputs: POIEngineProofInputs,
): POIEngineProofInputsWithListPOIData => {
  const dummyMerkleProofs = proofInputs.blindedCommitmentsIn.map(createDummyMerkleProof);
  return {
    ...proofInputs,
    poiMerkleroots: dummyMerkleProofs.map((proof) => proof.root),
    poiInMerkleProofIndices: dummyMerkleProofs.map((proof) => proof.indices),
    poiInMerkleProofPathElements: dummyMerkleProofs.map((proof) => proof.elements),
  };
};
