'use strict';

const assert = require('node:assert');
const { MailService } = require('../../src/main/mail');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  not ok - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function makeStore({ rules = [], blacklist = [] } = {}) {
  const applied = new Set();
  return {
    applied,
    listRules: () => rules,
    listBlacklist: () => blacklist,
    isFilterApplied: (key) => applied.has(key),
    markFilterApplied: (keys) => keys.forEach((key) => applied.add(key))
  };
}

function message(overrides = {}) {
  return {
    accountId: 'acc-1',
    path: 'INBOX',
    uid: 1,
    subject: 'hello',
    from: { name: '', address: 'a@example.com' },
    to: [{ address: 'me@example.com' }],
    timestamp: 5000,
    ...overrides
  };
}

(async () => {
  await test('groups blacklist and rule actions into flags and moves', async () => {
    const store = makeStore({
      rules: [
        { id: 'r1', enabled: true, field: 'from', value: 'github.com', action: 'archive', since: 0 },
        { id: 'r2', enabled: true, field: 'subject', value: 'invoice', action: 'star', since: 0 }
      ],
      blacklist: [{ email: 'spam@example.com', addedAt: 0 }]
    });
    const mail = new MailService(store);
    const flags = [];
    const moves = [];
    mail.setFlags = async (payload) => flags.push(payload);
    mail.move = async (payload) => moves.push(payload);
    const result = await mail.runFilters([
      message({ uid: 1, from: { address: 'spam@example.com' }, subject: 'Invoice' }),
      message({ uid: 2, from: { address: 'notifications@github.com' }, subject: 'PR' }),
      message({ uid: 3, from: { address: 'friend@example.com' }, subject: 'hi' })
    ]);
    assert.equal(result.processed, 2);
    assert.equal(result.blocked, 1);
    assert.equal(result.moved, 2);
    assert.equal(flags.length, 1);
    assert.equal(moves.length, 2);
    assert.deepEqual(
      moves.map((item) => item.target).sort(),
      ['archive', 'trash']
    );
    assert.equal(store.applied.size, 2);
  });

  await test('skips already processed messages and old messages', async () => {
    const store = makeStore({
      rules: [{ id: 'r1', enabled: true, field: 'from', value: 'github.com', action: 'star', since: 4000 }]
    });
    const mail = new MailService(store);
    let flags = 0;
    mail.setFlags = async () => {
      flags += 1;
    };
    mail.move = async () => {};
    store.applied.add('acc-1\u0000INBOX\u00001');
    const result = await mail.runFilters([
      message({ uid: 1, from: { address: 'noreply@github.com' } }),
      message({ uid: 2, from: { address: 'noreply@github.com' }, timestamp: 3000 }),
      message({ uid: 3, from: { address: 'noreply@github.com' }, timestamp: 6000 })
    ]);
    assert.equal(result.processed, 1);
    assert.equal(flags, 1);
  });

  await test('returns quietly when no rules exist', async () => {
    const mail = new MailService(makeStore());
    const result = await mail.runFilters([message()]);
    assert.equal(result.processed, 0);
  });

  console.log(`\n${passed} passed`);
})();
