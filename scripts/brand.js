#!/usr/bin/env node
/**
 * Locate the an5Brand checkout that supplies the shared brand tokens.
 *
 * Resolution order: AN5_BRAND_PATH, then an5Brand/ next to this repository
 * (the monorepo layout) or one level above it.
 */

const fs = require('fs');
const path = require('path');

const HINT = [
  'Could not locate the an5Brand submodule, which provides the shared brand tokens.',
  'Initialise it with: git submodule update --init an5Brand',
  'Or set AN5_BRAND_PATH to an existing an5Brand checkout.',
].join('\n');

function brandCandidates(fromDir) {
  const candidates = [];
  if (process.env.AN5_BRAND_PATH) candidates.push(path.resolve(process.env.AN5_BRAND_PATH));

  let dir = fromDir;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, 'an5Brand'));
    candidates.push(path.join(dir, '..', 'an5Brand'));
    dir = path.dirname(dir);
  }
  return candidates;
}

function resolveBrand() {
  for (const candidate of brandCandidates(__dirname)) {
    if (fs.existsSync(path.join(candidate, 'tokens.json'))) return candidate;
  }
  throw new Error(HINT);
}

/**
 * Load the shared generator. A standalone checkout of this repository has no
 * an5Brand on disk, and even inside the monorepo the generator's own
 * dependencies may not be installed.
 */
function loadBrand() {
  const brandRoot = resolveBrand();
  const entry = path.join(brandRoot, 'scripts', 'generate-icons.js');
  try {
    return { brandRoot, brand: require(entry) };
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') throw err;
    throw new Error([
      HINT,
      `Its generator dependencies are not installed: ${err.message.split('\n')[0]}`,
      'Run npm install in the monorepo root, or npm install in the an5Brand checkout.',
    ].join('\n'));
  }
}

module.exports = { resolveBrand, loadBrand };