'use strict';

const assert = require('node:assert');
const {
  normalizeSubject,
  threadKey,
  ruleMatches,
  blacklistMatches,
  planMessage
} = require('../../src/main/filters');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok - ${name}`);
  } catch (err) {
    console.error(`  not ok - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test('strips reply and forward prefixes repeatedly', () => {
  assert.equal(normalizeSubject('Re: Fwd: 本周评审'), '本周评审');
  assert.equal(normalizeSubject('答复：转发：预算'), '预算');
  assert.equal(normalizeSubject('  Re :  Re:   Hello  '), 'Hello');
  assert.equal(normalizeSubject('本周评审'), '本周评审');
  assert.equal(normalizeSubject(null), '');
});

test('thread key includes account and is case-insensitive', () => {
  assert.equal(threadKey('acc', 'Re: Budget'), threadKey('acc', 'budget'));
  assert.notEqual(threadKey('acc1', 'Budget'), threadKey('acc2', 'Budget'));
});

test('rule matches sender, subject and recipient', () => {
  const message = {
    subject: 'GitHub Pull Request',
    from: { name: 'GitHub', address: 'notifications@github.com' },
    to: [{ name: '林辰', address: 'lin@example.com' }],
    timestamp: 1000
  };
  assert.equal(
    ruleMatches({ enabled: true, field: 'from', value: 'github.com', since: 0 }, message),
    true
  );
  assert.equal(
    ruleMatches({ enabled: true, field: 'subject', value: 'pull', since: 0 }, message),
    true
  );
  assert.equal(
    ruleMatches({ enabled: true, field: 'to', value: 'lin@example.com', since: 0 }, message),
    true
  );
  assert.equal(
    ruleMatches({ enabled: true, field: 'subject', value: 'figma', since: 0 }, message),
    false
  );
});

test('rules do not retroactively match older mail', () => {
  const message = { subject: 'newsletter', from: { address: 'news@example.com' }, timestamp: 100 };
  assert.equal(
    ruleMatches({ enabled: true, field: 'from', value: 'news@', since: 200 }, message),
    false
  );
  assert.equal(
    ruleMatches({ enabled: true, field: 'from', value: 'news@', since: 50 }, message),
    true
  );
});

test('blacklist is case-insensitive and respects added time', () => {
  const message = { from: { address: 'Spam@Example.COM' }, timestamp: 2000 };
  assert.equal(blacklistMatches([{ email: 'spam@example.com', addedAt: 0 }], message), true);
  assert.equal(blacklistMatches([{ email: 'spam@example.com', addedAt: 3000 }], message), false);
  assert.equal(blacklistMatches([], message), false);
});

test('trash from blacklist wins over archive rule', () => {
  const message = {
    subject: 'Invoice',
    from: { address: 'spam@example.com' },
    timestamp: 5000
  };
  const plan = planMessage({
    rules: [
      { id: 'r1', enabled: true, field: 'from', value: 'spam@', action: 'archive', since: 0 }
    ],
    blacklist: [{ email: 'spam@example.com', addedAt: 0 }],
    message
  });
  assert.deepEqual(plan.actions.sort(), ['read', 'trash']);
  assert.equal(plan.blocked, true);
});

test('multiple rules combine flags and keep archive when no trash', () => {
  const message = {
    subject: 'Build failed',
    from: { address: 'ci@example.com' },
    timestamp: 5000
  };
  const plan = planMessage({
    rules: [
      { id: 'r1', enabled: true, field: 'from', value: 'ci@', action: 'star', since: 0 },
      { id: 'r2', enabled: false, field: 'subject', value: 'build', action: 'trash', since: 0 },
      { id: 'r3', enabled: true, field: 'subject', value: 'failed', action: 'archive', since: 0 }
    ],
    blacklist: [],
    message
  });
  assert.deepEqual(plan.actions.sort(), ['archive', 'star']);
  assert.deepEqual(plan.rules.sort(), ['r1', 'r3']);
});

console.log(`\n${passed} passed`);
