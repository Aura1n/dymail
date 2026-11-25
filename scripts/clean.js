'use strict';

/* Removes local build output and scratch data. Source, assets and scripts stay. */

const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const targets = ['dist', 'tmp', 'installer', '.verify'];

let freed = 0;
const sizeOf = (target) => {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce((sum, entry) => sum + sizeOf(path.join(target, entry)), 0);
};

for (const name of targets) {
  const target = path.join(root, name);
  if (!fs.existsSync(target)) continue;

  freed += sizeOf(target);
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`removed ${name}/`);
}

console.log(`\n${(freed / (1024 * 1024)).toFixed(1)} MB freed.`);
