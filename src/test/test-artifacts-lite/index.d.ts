export type Protocols = 'groth16';
export type Curves = 'bn128';

export interface VKey {
  protocol: Protocols;
  curve: Curves;
  nPublic: number;
  vk_alpha_1: string[];
  vk_beta_2: string[][];
  vk_gamma_2: string[][];
  vk_delta_2: string[][];
  vk_alphabeta_12: string[][];
  IC: string[][];
}

export interface Artifact {
  zkey: Uint8Array;
  wasm: Uint8Array;
  vkey: VKey;
}

export interface ArtifactConfig {
  nullifiers: number;
  commitments: number;
}

declare function getArtifacts(nullifiers: number, commitments: number): Artifact;
declare function getVKey(nullifiers: number, commitments: number): VKey;
declare function listArtifacts(): ArtifactConfig[];

declare function getArtifactsPOI(maxInputs: number, maxOutputs: number): Artifact;

export { getArtifacts, getVKey, listArtifacts, getArtifactsPOI };
