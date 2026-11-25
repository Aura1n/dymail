'use strict';

/* Exercises the real (non-demo) contacts store by stubbing Electron's app path. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const dir = path.join(os.tmpdir(), 'dymail-tests', 'contacts');
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const orig = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'electron') {
    return {
      app: { getPath: () => dir },
      safeStorage: { isEncryptionAvailable: () => false }
    };
  }
  return orig.call(this, request, ...rest);
};

const { Store } = require('../../src/main/store');
const store = new Store();
const log = [];
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  log.push(`${ok ? 'PASS' : 'FAIL'} ${label} = ${JSON.stringify(actual)}${ok ? '' : ` expected ${JSON.stringify(expected)}`}`);
};

check('empty list', store.listContacts(), []);

fs.writeFileSync(
  path.join(dir, 'contacts.json'),
  JSON.stringify([{ name: '手写的', email: ' hand@example.com ' }, { email: 'no-name@example.com' }, null, 3]),
  'utf8'
);
check(
  'hand-edited file is picked up',
  store.listContacts().map((item) => item.email).sort(),
  ['hand@example.com', 'no-name@example.com']
);
check(
  'missing name stays blank (renderer falls back to the address)',
  store.listContacts().map((item) => item.name).sort(),
  ['', '手写的']
);

const saved = store.saveContact({ name: '赵明', email: 'zhaoming@example.com' });
check('save returns record', saved, { name: '赵明', email: 'zhaoming@example.com' });
check('count after save', store.listContacts().length, 3);

try {
  store.saveContact({ name: 'dup', email: 'ZHAOMING@example.com' });
  log.push('FAIL duplicate accepted');
} catch (err) {
  check('duplicate rejected', err.message, '该联系人已存在');
}
try {
  store.saveContact({ name: 'bad', email: 'not-an-email' });
  log.push('FAIL invalid accepted');
} catch (err) {
  check('invalid email rejected', err.message, '联系人邮箱格式不正确');
}

store.saveContact({ name: '赵明改', email: 'zhaoming@example.com', originalEmail: 'zhaoming@example.com' });
check(
  'upsert by originalEmail',
  store.listContacts().find((item) => item.email === 'zhaoming@example.com').name,
  '赵明改'
);
check('count after upsert', store.listContacts().length, 3);

check('delete', store.deleteContact('hand@example.com'), true);
check('delete missing', store.deleteContact('nobody@example.com'), false);
check('count after delete', store.listContacts().length, 2);

const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'contacts.json'), 'utf8'));
check('file shape', Array.isArray(onDisk) && onDisk.length, 2);
check('no tmp left', fs.existsSync(path.join(dir, 'contacts.json.tmp')), false);

fs.writeFileSync(path.join(dir, 'contacts.json'), '{oops', 'utf8');
try {
  store.listContacts();
  log.push('FAIL broken json accepted');
} catch (err) {
  check('broken json message', /^联系人文件不是合法 JSON/.test(err.message), true);
}

fs.writeFileSync(path.join(dir, 'contacts.json'), JSON.stringify({ contacts: [{ name: '包在对象里', email: 'wrapped@example.com' }] }), 'utf8');
check('object wrapper accepted', store.listContacts().map((item) => item.email), ['wrapped@example.com']);

if (log.some((line) => line.startsWith('FAIL'))) process.exitCode = 1;

console.log(log.join('\n'));
