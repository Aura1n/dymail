'use strict';

const assert = require('node:assert');
const { Scheduler } = require('../../src/main/scheduler');

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

function makeStore(draft) {
  const calls = { deleted: [], errors: [] };
  return {
    calls,
    listScheduled: async () => [
      {
        id: draft.id,
        sendAt: draft.sendAt,
        nextAttempt: draft.nextAttempt || 0,
        subject: draft.subject
      }
    ],
    getDraft: async (id) => (id === draft.id ? { ...draft } : null),
    deleteDraft: async (id) => {
      calls.deleted.push(id);
      return true;
    },
    markScheduledError: async (id, message, nextAttempt) => {
      calls.errors.push({ id, message, nextAttempt });
      return true;
    }
  };
}

function draft(overrides = {}) {
  return {
    id: 'draft-1',
    accountId: 'acc-1',
    to: 'a@example.com',
    cc: '',
    bcc: '',
    subject: '定时邮件',
    html: '<p>hi</p>',
    text: '',
    inReplyTo: '',
    references: '',
    attachments: [],
    sendAt: new Date(Date.now() - 1000).toISOString(),
    nextAttempt: 0,
    ...overrides
  };
}

(async () => {
  await test('sends a due draft and removes it', async () => {
    const store = makeStore(draft());
    const sent = [];
    const mail = {
      send: async (payload) => {
        sent.push(payload);
        return { messageId: '<x@y>', savedToSent: true };
      }
    };
    const events = [];
    const scheduler = new Scheduler({ store, mail, onEvent: (event) => events.push(event) });
    await scheduler.tick();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].subject, '定时邮件');
    assert.deepEqual(store.calls.deleted, ['draft-1']);
    assert.equal(events[0].type, 'sent');
  });

  await test('keeps the draft and records an error when sending fails', async () => {
    const store = makeStore(draft());
    const mail = {
      send: async () => {
        throw new Error('SMTP rejected');
      }
    };
    const events = [];
    const scheduler = new Scheduler({ store, mail, onEvent: (event) => events.push(event) });
    await assert.rejects(() => scheduler.send('draft-1'), /SMTP rejected/);
    assert.equal(store.calls.errors.length, 1);
    assert.match(store.calls.errors[0].message, /SMTP rejected/);
    assert.equal(events[0].type, 'error');
    assert.equal(store.calls.deleted.length, 0);
  });

  await test('does not send a draft that is not due', async () => {
    const store = makeStore(draft({ sendAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }));
    let sends = 0;
    const mail = {
      send: async () => {
        sends += 1;
      }
    };
    const scheduler = new Scheduler({ store, mail });
    await scheduler.tick();
    assert.equal(sends, 0);
  });

  await test('manual send ignores the scheduled time', async () => {
    const store = makeStore(draft({ sendAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() }));
    let sends = 0;
    const mail = {
      send: async () => {
        sends += 1;
        return { savedToSent: true };
      }
    };
    const scheduler = new Scheduler({ store, mail });
    await scheduler.send('draft-1', { manual: true });
    assert.equal(sends, 1);
  });

  await test('keeps going when one due message fails', async () => {
    const sent = [];
    const store = {
      listScheduled: async () => [
        { id: 'bad', sendAt: new Date(Date.now() - 1000).toISOString(), nextAttempt: 0 },
        { id: 'good', sendAt: new Date(Date.now() - 1000).toISOString(), nextAttempt: 0 }
      ],
      getDraft: async (id) => ({ ...draft({ id }), subject: id }),
      deleteDraft: async () => true,
      markScheduledError: async () => true
    };
    const mail = {
      send: async ({ subject }) => {
        if (subject === 'bad') throw new Error('SMTP rejected');
        sent.push(subject);
        return { savedToSent: true };
      }
    };
    const scheduler = new Scheduler({ store, mail });
    await scheduler.tick();
    assert.deepEqual(sent, ['good']);
  });

  console.log(`\n${passed} passed`);
})();
