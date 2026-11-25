'use strict';

/* Offline check for the two 已删除 features: restore moves a uid set back to
   INBOX and clears the deletion flag on the copies, and the automatic purge
   expunges only what is older than the configured day count. */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

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

/* mailbox: { [accountId]: [{ uid, date }] } — date null means no internalDate. */
function makeService({ accounts, mailbox, folders, failConnect } = {}) {
  const calls = [];
  const list = accounts || [{ id: 'a', email: 'a@b.c' }];
  const client = {
    mailbox: { path: 'INBOX' },
    async messageMove(range, destination) {
      calls.push({ cmd: 'MOVE', range, destination });
      const uidMap = new Map();
      const dest = (mailbox && mailbox.destinationUids) || [];
      let index = 0;
      for (const part of String(range).split(',')) {
        const bounds = part.split(':').map(Number);
        const last = bounds.length > 1 ? bounds[1] : bounds[0];
        for (let uid = bounds[0]; uid <= last; uid += 1) {
          uidMap.set(uid, dest[index] || uid + 100);
          index += 1;
        }
      }
      return { uidMap };
    },
    async messageFlagsAdd(range, flags) {
      calls.push({ cmd: 'STORE+FLAGS', range, flags });
    },
    async messageFlagsRemove(range, flags) {
      calls.push({ cmd: 'STORE-FLAGS', range, flags });
    },
    async messageDelete(range) {
      calls.push({ cmd: 'EXPUNGE', range });
    },
    fetch(range) {
      calls.push({ cmd: 'FETCH', range });
      const items = (mailbox && mailbox.messages) || [];
      return (async function* () {
        for (const item of items) {
          yield { uid: item.uid, internalDate: item.date ? new Date(item.date) : null };
        }
      })();
    }
  };

  const service = new MailService({
    getAccount: (id) => list.find((account) => account.id === id) || null,
    listAccounts: () => list
  });
  service._connect = async (account) => {
    if (failConnect && failConnect.includes(account.id)) throw new Error('连接被拒绝');
    return client;
  };
  service._ensureMailbox = async (c, pathName) => ({
    path: pathName,
    exists: mailbox && mailbox.exists != null ? mailbox.exists : 10
  });
  service._findFolder = async (c, account, session, role) => {
    const table = folders || { inbox: 'INBOX', trash: 'Trash', archive: '归档' };
    const found = table[role];
    return found ? { role, path: found, name: found, delimiter: '/' } : null;
  };
  return { service, calls, client };
}

const DAY = 86400000;

(async () => {
  await test('restore sends one MOVE to the inbox', async () => {
    const { service, calls } = makeService();
    const result = await service.restore({ accountId: 'a', path: 'Trash', uids: [5, 6, 9] });
    assert.deepStrictEqual(result, { path: 'INBOX' });
    assert.strictEqual(calls[0].cmd, 'MOVE');
    assert.strictEqual(calls[0].range, '5:6,9');
    assert.strictEqual(calls[0].destination, 'INBOX');
  });

  await test('restore clears \\Deleted on the destination uids', async () => {
    const { service, calls } = makeService({ mailbox: { destinationUids: [201, 202, 207] } });
    await service.restore({ accountId: 'a', path: 'Trash', uids: [5, 6, 9] });
    const cleared = calls.find((call) => call.cmd === 'STORE-FLAGS');
    assert.ok(cleared, 'no flag clear');
    assert.strictEqual(cleared.range, '201:202,207');
    assert.deepStrictEqual(cleared.flags, ['\\Deleted']);
  });

  await test('a single uid still restores', async () => {
    const { service, calls } = makeService();
    await service.restore({ accountId: 'a', path: 'Trash', uid: 77 });
    assert.strictEqual(calls[0].range, '77');
  });

  await test('an account without an inbox is refused before any MOVE', async () => {
    const { service, calls } = makeService({ folders: { trash: 'Trash' } });
    await assert.rejects(
      () => service.restore({ accountId: 'a', path: 'Trash', uid: 3 }),
      /该账户没有收件箱/
    );
    assert.strictEqual(calls.length, 0);
  });

  await test('an empty MOVE response does not break the restore', async () => {
    const { service, calls } = makeService();
    service._connect = async () => ({
      mailbox: { path: 'INBOX' },
      async messageMove(range) {
        calls.push({ cmd: 'MOVE', range });
        return undefined;
      },
      async messageFlagsRemove(range) {
        calls.push({ cmd: 'STORE-FLAGS', range });
      }
    });
    const result = await service.restore({ accountId: 'a', path: 'Trash', uid: 3 });
    assert.deepStrictEqual(result, { path: 'INBOX' });
    assert.strictEqual(calls.filter((call) => call.cmd === 'STORE-FLAGS').length, 0);
  });

  await test('purge only expunges mail older than the cutoff', async () => {
    const { service, calls } = makeService({
      mailbox: {
        exists: 3,
        destinationUids: [],
        messages: [
          { uid: 4, date: new Date(Date.now() - 45 * DAY).toISOString() },
          { uid: 8, date: new Date(Date.now() - 8 * DAY).toISOString() },
          { uid: 12, date: null }
        ]
      }
    });
    const results = await service.purgeTrash({ days: 30 });
    assert.deepStrictEqual(results, [{ accountId: 'a', email: 'a@b.c', removed: 1 }]);
    assert.deepStrictEqual(
      calls.map((call) => `${call.cmd}:${call.range}`),
      ['FETCH:1:*', 'STORE+FLAGS:4', 'EXPUNGE:4']
    );
    assert.deepStrictEqual(calls[1].flags, ['\\Deleted']);
  });

  /* ImapFlow's toValidDate drops a numeric SEARCH criterion silently, which
     would make a BEFORE search match the whole mailbox and expunge everything. */
  await test('purge reads internal dates instead of a server SEARCH', async () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'mail.js'), 'utf8');
    const start = source.indexOf('async purgeTrash');
    const body = source.slice(start, source.indexOf('\n  }', start));
    assert.match(body, /internalDate/);
    assert.ok(!/messageSearch/.test(body), 'purge must not trust SEARCH');
  });

  await test('purge splits a large stale set into chunks', async () => {
    const messages = [];
    for (let uid = 1; uid <= 250; uid += 1) {
      messages.push({ uid, date: new Date(Date.now() - 60 * DAY).toISOString() });
    }
    const { service, calls } = makeService({ mailbox: { exists: 250, messages } });
    const results = await service.purgeTrash({ days: 30 });
    assert.strictEqual(results[0].removed, 250);
    const expunges = calls.filter((call) => call.cmd === 'EXPUNGE');
    assert.strictEqual(expunges.length, 2);
    assert.strictEqual(expunges[0].range, '1:200');
    assert.strictEqual(expunges[1].range, '201:250');
  });

  await test('an account with no trash folder is left alone', async () => {
    const { service, calls } = makeService({ folders: { inbox: 'INBOX' } });
    const results = await service.purgeTrash({ days: 30 });
    assert.deepStrictEqual(results, [{ accountId: 'a', email: 'a@b.c', removed: 0 }]);
    assert.strictEqual(calls.length, 0);
  });

  await test('an empty trash skips the fetch', async () => {
    const { service, calls } = makeService({ mailbox: { exists: 0, messages: [] } });
    const results = await service.purgeTrash({ days: 30 });
    assert.strictEqual(results[0].removed, 0);
    assert.strictEqual(calls.filter((call) => call.cmd === 'FETCH').length, 0);
  });

  await test('a zero or nonsense day count purges nothing', async () => {
    const { service, calls } = makeService({
      mailbox: { exists: 1, messages: [{ uid: 1, date: new Date(0).toISOString() }] }
    });
    for (const days of [0, -5, 2.5, 'x', undefined]) {
      assert.deepStrictEqual(await service.purgeTrash({ days }), [], `${days} should be refused`);
    }
    assert.strictEqual(calls.length, 0);
  });

  await test('one failing account still reports the others', async () => {
    const { service } = makeService({
      accounts: [
        { id: 'a', email: 'a@b.c' },
        { id: 'b', email: 'b@b.c' }
      ],
      failConnect: ['b'],
      mailbox: { exists: 1, messages: [{ uid: 3, date: new Date(Date.now() - 40 * DAY).toISOString() }] }
    });
    const results = await service.purgeTrash({ days: 30 });
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].removed, 1);
    assert.ok(results[1].error, 'second account should carry an error');
    assert.strictEqual(results[1].removed, 0);
    assert.strictEqual(results[1].email, 'b@b.c');
  });

  /* ---- settings store ---- */
  await test('the purge day count is stored and validated', async () => {
    const dir = path.join(os.tmpdir(), 'dymail-tests', 'purge');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const orig = Module._load;
    Module._load = function (request, ...rest) {
      if (request === 'electron') {
        return { app: { getPath: () => dir }, safeStorage: { isEncryptionAvailable: () => false } };
      }
      return orig.call(this, request, ...rest);
    };
    try {
      delete require.cache[require.resolve('../../src/main/store')];
      const { Store } = require('../../src/main/store');
      const store = new Store();
      assert.strictEqual(store.getSettings().trashPurgeDays, 30);
      assert.strictEqual(store.updateSettings({ trashPurgeDays: 60 }).trashPurgeDays, 60);
      assert.strictEqual(store.updateSettings({ trashPurgeDays: 0 }).trashPurgeDays, 0);
      assert.strictEqual(store.updateSettings({ trashPurgeDays: 7 }).trashPurgeDays, 0);
      assert.strictEqual(store.updateSettings({ trashPurgeDays: '90' }).trashPurgeDays, 90);
      assert.strictEqual(store.markTrashPurged(123456), 123456);
      const saved = JSON.parse(fs.readFileSync(path.join(dir, 'dymail.json'), 'utf8'));
      assert.strictEqual(saved.settings.trashPurgeAt, 123456);
      assert.strictEqual(saved.settings.trashPurgeDays, 90);
    } finally {
      Module._load = orig;
    }
  });

  /* ---- wiring ---- */
  await test('ipc layer forwards the restore batch and exposes the purge', async () => {
    const root = path.join(__dirname, '..', '..');
    const main = fs.readFileSync(path.join(root, 'src', 'main', 'main.js'), 'utf8');
    const start = main.indexOf("handle('mail:restore'");
    assert.ok(start >= 0, 'mail:restore handler missing');
    assert.match(main.slice(start, main.indexOf('\n  );', start)), /uids:\s*uidList\(payload\.uids\)/);
    assert.match(main, /handle\('mail:purge-trash'/);
    assert.match(main, /store\.markTrashPurged\(Date\.now\(\)\)/);
    const preload = fs.readFileSync(path.join(root, 'src', 'preload', 'preload.js'), 'utf8');
    assert.match(preload, /restore:\s*\(payload\)\s*=>\s*call\('mail:restore',\s*payload\)/);
    assert.match(preload, /purgeTrash:\s*\(\)\s*=>\s*call\('mail:purge-trash'/);
  });

  await test('the renderer only offers 还原 inside 已删除', async () => {
    const root = path.join(__dirname, '..', '..');
    const html = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.html'), 'utf8');
    assert.match(html, /id="batch-restore"[^>]*hidden/);
    assert.match(html, /id="action-restore"[^>]*hidden/);
    assert.match(html, /id="trash-purge-select"/);
    const app = fs.readFileSync(path.join(root, 'src', 'renderer', 'app.js'), 'utf8');
    assert.match(app, /els\.batchRestore\.hidden\s*=\s*!viewIsTrash\(\)/);
    assert.match(app, /els\.actionRestore\.hidden\s*=\s*!inTrash/);
    assert.match(app, /api\.mail\.restore\(/);
    assert.match(app, /maybePurgeTrash\(\);/);
    assert.match(app, /api\.mail\.purgeTrash\(\)/);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
