'use strict';

/* Offline check for the archive fallback: accounts whose server has no archive
   folder (QQ, Gmail over IMAP) must create 归档 once instead of failing. */

const assert = require('node:assert');
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

function makeService({ createFails = false } = {}) {
  const calls = [];
  const boxes = [
    { path: 'INBOX', name: '收件箱', delimiter: '/', flags: [] },
    { path: 'Sent Messages', name: '已发送', delimiter: '/', flags: [] },
    { path: 'Deleted Messages', name: '已删除', delimiter: '/', flags: [] }
  ];
  const client = {
    mailbox: { path: 'INBOX' },
    async list() {
      return boxes.map((box) => ({ ...box }));
    },
    async mailboxCreate(name) {
      calls.push({ cmd: 'CREATE', name });
      if (createFails) throw new Error('CREATE failed: Mailbox name is invalid');
      boxes.push({ path: name, name, delimiter: '/', flags: [] });
      return { path: name, name, delimiter: '/', flags: [] };
    },
    async messageMove(range, destination, options) {
      calls.push({ cmd: 'MOVE', range, destination, options });
    }
  };
  const service = new MailService({
    getAccount: (id) => ({ id, email: 'a@b.c', imap: { host: 'x' }, smtp: { host: 'y' } })
  });
  service._connect = async () => client;
  service._ensureMailbox = async (c, pathName) => ({ path: pathName });
  return { service, calls };
}

(async () => {
  await test('archiving on an account without an archive folder creates one', async () => {
    const { service, calls } = makeService();
    const result = await service.move({ accountId: 'a', path: 'INBOX', uids: [3, 4], target: 'archive' });
    assert.deepStrictEqual(calls[0], { cmd: 'CREATE', name: '归档' });
    assert.strictEqual(calls[1].cmd, 'MOVE');
    assert.strictEqual(calls[1].range, '3:4');
    assert.strictEqual(calls[1].destination, '归档');
    assert.strictEqual(result.path, '归档');
  });

  await test('the created folder is reused, not created again', async () => {
    const { service, calls } = makeService();
    await service.move({ accountId: 'a', path: 'INBOX', uids: [3], target: 'archive' });
    await service.move({ accountId: 'a', path: 'INBOX', uids: [9], target: 'archive' });
    assert.strictEqual(calls.filter((call) => call.cmd === 'CREATE').length, 1);
    assert.strictEqual(calls[2].destination, '归档');
    assert.strictEqual(calls[2].range, '9');
  });

  await test('a refused CREATE says so', async () => {
    const { service } = makeService({ createFails: true });
    await assert.rejects(
      () => service.move({ accountId: 'a', path: 'INBOX', uids: [3], target: 'archive' }),
      /没有归档文件夹，服务器也拒绝新建/
    );
  });

  await test('an account that already has Archive keeps using it', async () => {
    const { service, calls } = makeService();
    service._findFolder = async (client, account, session, role) =>
      role === 'archive' ? { role, path: 'Archive', name: 'Archive', delimiter: '/' } : null;
    await service.move({ accountId: 'a', path: 'INBOX', uids: [5], target: 'archive' });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].destination, 'Archive');
  });

  await test('a missing trash folder is still not created', async () => {
    const { service } = makeService();
    service._findFolder = async () => null;
    await assert.rejects(
      () => service.move({ accountId: 'a', path: 'INBOX', uids: [5], target: 'trash' }),
      /该账户没有已删除文件夹/
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
