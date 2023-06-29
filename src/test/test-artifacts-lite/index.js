/* eslint-disable global-require */
/* eslint-disable import/no-dynamic-require */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/strict-boolean-expressions */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
const fs = require('fs');
const decompress = require('brotli/decompress');
const artifacts = require('./artifacts.json');

const cache = [];

function getArtifact(nullifiers, commitments) {
  cache[nullifiers] ??= [];

  if (!cache[nullifiers][commitments]) {
    cache[nullifiers][commitments] = {
      zkey: decompress(fs.readFileSync(`${__dirname}/${nullifiers}x${commitments}/zkey.br`)),
      wasm: decompress(fs.readFileSync(`${__dirname}/${nullifiers}x${commitments}/wasm.br`)),
      vkey: require(`${__dirname}/${nullifiers}x${commitments}/vkey`),
    };
  }

  return cache[nullifiers][commitments];
}

function getVKey(nullifiers, commitments) {
  if (!cache[nullifiers] || !cache[nullifiers][commitments]) {
    return require(`${__dirname}/${nullifiers}x${commitments}/vkey`);
  }

  return cache[nullifiers][commitments].vkey;
}

function listArtifacts() {
  return artifacts;
}

module.exports = {
  getArtifact,
  getVKey,
  listArtifacts,
};
