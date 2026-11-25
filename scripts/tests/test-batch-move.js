'use strict';

/* Offline check for batched IMAP move/delete: a whole uid set must turn into
   one command, not one round-trip per message. */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MailService } = require('../../src/main/mail');

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL ${name}: ${err && err.message}`);
  }
}

function makeService() {
  const calls = [];
  const client = {
    mailbox: { path: 'INBOX' },
    async messageMove(range, destination, options) {
      calls.push({ cmd: 'MOVE', range, destination, options });
    },
    async messageDelete(range, options) {
      calls.push({ cmd: 'EXPUNGE', range, options });
    }
  };
  const service = new MailService({
    getAccount: (id) => ({ id, email: 'a@b.c', imap: { host: 'x' }, smtp: { host: 'y' } })
  });
  service._connect = async () => client;
  service._ensureMailbox = async (c, pathName) => ({ path: pathName });
  service._findFolder = async () => ({ path: 'Trash' });
  return { service, calls };
}

(async () => {
  await test('a uid set moves with one MOVE command', async () => {
    const { service, calls } = makeService();
    await service.move({
      accountId: 'a',
      path: 'INBOX',
      uids: [1, 2, 3, 7, 9, 10, 11],
      target: 'trash'
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].cmd, 'MOVE');
    assert.strictEqual(calls[0].range, '1:3,7,9:11');
    assert.strictEqual(calls[0].destination, 'Trash');
    assert.strictEqual(calls[0].options.uid, true);
  });

  await test('50 checked mails still cost one command', async () => {
    const { service, calls } = makeService();
    const uids = [];
    for (let i = 1; i <= 50; i += 1) uids.push(i * 2);
    await service.move({ accountId: 'a', path: 'INBOX', uids, target: 'archive' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].range.split(',').length, 50);
    assert.match(calls[0].range, /^2,4,6/);
  });

  await test('a single uid keeps working', async () => {
    const { service, calls } = makeService();
    await service.move({ accountId: 'a', path: 'INBOX', uid: 42, target: 'archive' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].range, '42');
  });

  await test('permanent delete batches too', async () => {
    const { service, calls } = makeService();
    await service.deletePermanent({ accountId: 'a', path: 'INBOX', uids: [4, 5, 9] });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].cmd, 'EXPUNGE');
    assert.strictEqual(calls[0].range, '4:5,9');
  });

  await test('duplicates and junk uids collapse', async () => {
    const { service, calls } = makeService();
    await service.deletePermanent({ accountId: 'a', path: 'INBOX', uids: [8, 8, '8', 0, -3, 'x', 12] });
    assert.strictEqual(calls[0].range, '8,12');
  });

  await test('empty selection is refused', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.move({ accountId: 'a', path: 'INBOX', uids: [], uid: 0, target: 'trash' }),
      /邮件不存在/
    );
  });

  await test('oversized batch is refused', async () => {
    const { service } = makeService();
    const uids = [];
    for (let i = 1; i <= 501; i += 1) uids.push(i);
    await assert.rejects(
      () => service.move({ accountId: 'a', path: 'INBOX', uids, target: 'trash' }),
      /一次最多操作 500 封邮件/
    );
  });

  await test('unknown target is refused', async () => {
    const { service } = makeService();
    await assert.rejects(
      () => service.move({ accountId: 'a', path: 'INBOX', uids: [1], target: 'junk' }),
      /目标文件夹无效/
    );
  });

  /* The renderer batches through IPC, so a handler that forgets to forward the
     uid list silently turns a 50-mail delete into "邮件不存在". */
  await test('ipc handlers forward the batch uid list', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'main.js'), 'utf8');
    for (const channel of ['mail:move', 'mail:delete-permanent']) {
      const start = source.indexOf(`handle('${channel}'`);
      assert.ok(start >= 0, `${channel} handler missing`);
      const body = source.slice(start, source.indexOf('\n  );', start));
      assert.match(body, /uids:\s*uidList\(payload\.uids\)/, `${channel} drops payload.uids`);
    }
  });

  await test('single-message delete still reaches the service', async () => {
    const { service, calls } = makeService();
    /* What the handler builds when the payload carries no uids array. */
    await service.deletePermanent({ accountId: 'a', path: 'INBOX', uid: 77, uids: undefined });
    assert.strictEqual(calls[0].range, '77');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
