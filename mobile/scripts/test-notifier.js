'use strict';

/* Offline tests for the new-mail decision logic (core/notifier.js), using a fake mail core.
 *   node mobile/scripts/test-notifier.js */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createNotifier } = require('../core/notifier');

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name} — ${err.message}`);
  }
}

function makeEnv() {
  const env = {
    inbox: [],
    settings: { notifyNewMail: true },
    rules: { rules: [], blacklist: [] },
    accounts: [{ id: 'a1', email: 'me@example.com', name: '我' }],
    failList: false,
    lastListPayload: null,
    out: [],
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'dymail-notifier-'))
  };
  env.call = async (channel, payload) => {
    switch (channel) {
      case 'mail:list':
        env.lastListPayload = payload;
        if (env.failList) throw new Error('offline');
        return { messages: env.inbox.slice() };
      case 'settings:get':
        return env.settings;
      case 'rules:list':
        return env.rules;
      case 'accounts:list':
        return env.accounts;
      default:
        throw new Error(`unexpected channel ${channel}`);
    }
  };
  env.make = (options = {}) =>
    createNotifier({ call: env.call, bus: new EventEmitter(), dataDir: env.dir, emit: (c) => env.out.push(c), debounceMs: 5, startDelayMs: -1, log: () => {}, ...options });
  return env;
}

const msg = (uid, extra = {}) => ({
  uid,
  seen: false,
  subject: `主题${uid}`,
  from: { name: `发件人${uid}`, address: `f${uid}@example.com` },
  to: [],
  timestamp: Date.now(),
  ...extra
});

(async () => {
  await test('first sight only records a baseline (no flood of old mail)', async () => {
    const env = makeEnv();
    env.inbox = [msg(1), msg(2), msg(3)];
    const n = env.make();
    await n.check('a1');
    assert.equal(env.out.length, 0);
    assert.equal(env.lastListPayload.role, 'inbox', 'must ask for role inbox so the filters run');
    assert.equal(env.lastListPayload.path, 'INBOX');
  });

  await test('one new unread mail → one notification with sender and subject', async () => {
    const env = makeEnv();
    env.inbox = [msg(1), msg(2)];
    const n = env.make();
    await n.check('a1');
    env.inbox.push(msg(3));
    await n.check('a1');
    assert.equal(env.out.length, 1);
    assert.deepEqual(
      { type: env.out[0].type, tag: env.out[0].tag, count: env.out[0].count, title: env.out[0].title, body: env.out[0].body },
      { type: 'notify', tag: 'a1', count: 1, title: '我 · 收件箱', body: '发件人3：主题3' }
    );
  });

  await test('the same mail is never announced twice', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    const n = env.make();
    await n.check('a1');
    env.inbox.push(msg(2));
    await n.check('a1');
    await n.check('a1');
    await n.check('a1');
    assert.equal(env.out.length, 1);
  });

  await test('several new mails → one summary with the count and the newest', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    const n = env.make();
    await n.check('a1');
    env.inbox.push(msg(2), msg(3), msg(4));
    await n.check('a1');
    assert.equal(env.out.length, 1);
    assert.equal(env.out[0].count, 3);
    assert.equal(env.out[0].body, '3 封新邮件 · 最新：发件人4：主题4');
  });

  await test('mail that is already read is not announced, but the baseline moves on', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    const n = env.make();
    await n.check('a1');
    env.inbox.push(msg(2, { seen: true }));
    await n.check('a1');
    assert.equal(env.out.length, 0);
    env.inbox.push(msg(3));
    await n.check('a1');
    assert.equal(env.out.length, 1);
    assert.equal(env.out[0].body, '发件人3：主题3');
  });

  await test('a filter rule that archives/reads/deletes silences the mail', async () => {
    const env = makeEnv();
    env.rules = { rules: [{ id: 'r1', enabled: true, field: 'from', value: 'promo', action: 'archive', since: 1 }], blacklist: [] };
    env.inbox = [msg(1)];
    const n = env.make();
    await n.check('a1');
    env.inbox.push(msg(2, { from: { name: 'Promo Team', address: 'promo@shop.example' } }), msg(3));
    await n.check('a1');
    assert.equal(env.out.length, 1);
    assert.equal(env.out[0].body, '发件人3：主题3');
  });

  await test('a blacklisted sender is silent; a star-only rule still notifies', async () => {
    const env = makeEnv();
    env.rules = {
      rules: [{ id: 'r2', enabled: true, field: 'subject', value: '重要', action: 'star', since: 1 }],
      blacklist: [{ email: 'spam@bad.example', addedAt: 1 }]
    };
    env.inbox = [msg(1)];
    const n = env.make();
    await n.check('a1');
    env.inbox.push(msg(2, { from: { name: 'S', address: 'spam@bad.example' } }), msg(3, { subject: '重要通知' }));
    await n.check('a1');
    assert.equal(env.out.length, 1);
    assert.equal(env.out[0].body, '发件人3：重要通知');
  });

  await test('notifications switched off → silent, and old mail does not pile up for later', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    const n = env.make();
    await n.check('a1');
    env.settings = { notifyNewMail: false };
    env.inbox.push(msg(2));
    await n.check('a1');
    assert.equal(env.out.length, 0);
    env.settings = { notifyNewMail: true };
    env.inbox.push(msg(3));
    await n.check('a1');
    assert.equal(env.out.length, 1);
    assert.equal(env.out[0].body, '发件人3：主题3');
  });

  await test('the baseline survives a restart (no duplicate after the core relaunches)', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    await env.make().check('a1');
    env.inbox.push(msg(2));
    await env.make().check('a1');
    assert.equal(env.out.length, 1);
    await env.make().check('a1'); // third "launch", nothing new
    assert.equal(env.out.length, 1);
  });

  await test('mail that arrived while the core was down is announced after the restart', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    await env.make().check('a1');
    env.inbox.push(msg(2), msg(3)); // arrived while "offline"
    await env.make().check('a1');
    assert.equal(env.out.length, 1);
    assert.equal(env.out[0].count, 2);
  });

  await test('uids going backwards (server renumbered the mailbox) re-baselines silently', async () => {
    const env = makeEnv();
    env.inbox = [msg(500), msg(501)];
    const n = env.make();
    await n.check('a1');
    env.inbox = [msg(1), msg(2)];
    await n.check('a1');
    assert.equal(env.out.length, 0);
    env.inbox.push(msg(3));
    await n.check('a1');
    assert.equal(env.out.length, 1);
  });

  await test('deleting the newest mail does not break later notifications', async () => {
    const env = makeEnv();
    env.inbox = [msg(1), msg(2)];
    const n = env.make();
    await n.check('a1');
    env.inbox = [msg(1)]; // uid 2 deleted
    await n.check('a1');
    env.inbox.push(msg(3));
    await n.check('a1');
    assert.equal(env.out.length, 1);
  });

  await test('a failed fetch announces nothing and is retried later without losing the mail', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    const n = env.make();
    await n.check('a1');
    env.inbox.push(msg(2));
    env.failList = true;
    await n.check('a1');
    assert.equal(env.out.length, 0);
    env.failList = false;
    await n.check('a1');
    assert.equal(env.out.length, 1);
  });

  await test('a failed settings lookup does not swallow the mail', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    const n = env.make();
    await n.check('a1');
    env.inbox.push(msg(2));
    const original = env.call;
    let broken = true;
    const flaky = async (channel, payload) => {
      if (channel === 'settings:get' && broken) throw new Error('boom');
      return original(channel, payload);
    };
    const n2 = createNotifier({ call: flaky, bus: new EventEmitter(), dataDir: env.dir, emit: (c) => env.out.push(c), debounceMs: 5, startDelayMs: -1, log: () => {} });
    await n2.check('a1');
    assert.equal(env.out.length, 0);
    broken = false;
    await n2.check('a1');
    assert.equal(env.out.length, 1);
  });

  await test('push, reconnect and heartbeat for the same mailbox collapse into one announcement', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    const bus = new EventEmitter();
    const n = env.make({ bus });
    n.start();
    await n.check('a1');
    env.inbox.push(msg(2));
    bus.emit('event', 'mail:push', { accountId: 'a1', path: 'INBOX', count: 2 });
    bus.emit('event', 'mail:status', { accountId: 'a1', state: 'online' });
    n.check('a1');
    await n.idle();
    n.stop();
    assert.equal(env.out.length, 1);
  });

  await test('checkAll covers every account', async () => {
    const env = makeEnv();
    env.accounts = [{ id: 'a1', email: 'a@x.com', name: '' }, { id: 'a2', email: 'b@x.com', name: 'B' }];
    env.inbox = [msg(1)];
    const n = env.make();
    await n.checkAll();
    env.inbox.push(msg(2));
    await n.checkAll();
    assert.equal(env.out.length, 2);
    assert.deepEqual(env.out.map((c) => c.title).sort(), ['a@x.com · 收件箱', 'B · 收件箱'].sort());
  });

  await test('scheduled-send results are announced; repeated failures are not', async () => {
    const env = makeEnv();
    const bus = new EventEmitter();
    const n = env.make({ bus });
    n.start();
    bus.emit('event', 'scheduled:changed', { type: 'sent', subject: '周报' });
    bus.emit('event', 'scheduled:changed', { type: 'error', subject: '周报', message: '连接超时', attempts: 1 });
    bus.emit('event', 'scheduled:changed', { type: 'error', subject: '周报', message: '连接超时', attempts: 2 });
    bus.emit('event', 'scheduled:changed', { reason: 'saved' });
    n.stop();
    assert.equal(env.out.length, 2);
    assert.equal(env.out[0].title, '定时邮件已发送');
    assert.equal(env.out[1].title, '定时邮件发送失败');
    assert.equal(env.out[1].body, '周报：连接超时');
  });

  await test('very long subjects are clipped to a sane notification size', async () => {
    const env = makeEnv();
    env.inbox = [msg(1)];
    const n = env.make();
    await n.check('a1');
    env.inbox.push(msg(2, { subject: '很长'.repeat(500) }));
    await n.check('a1');
    assert.ok(env.out[0].body.length <= 240, `body is ${env.out[0].body.length} chars`);
  });

  console.log(failed ? `\n${failed} test(s) failed` : '\nall notifier tests passed');
  process.exit(failed ? 1 : 0);
})();
