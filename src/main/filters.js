'use strict';

/* Pure helpers shared by the mail filter engine and by tests. Keeping the
   matching rules free of IMAP lets the behavior stay predictable offline. */

const RULE_FIELDS = new Set(['from', 'subject', 'to']);
const RULE_ACTIONS = new Set(['read', 'star', 'archive', 'trash']);

const SUBJECT_PREFIX =
  /^\s*(?:(?:re|fw|fwd|aw|sv|答复|回复|转发|转寄)\s*[:：]\s*)+/i;

function normalizeSubject(subject) {
  let value = String(subject == null ? '' : subject).replace(/\s+/g, ' ').trim();
  for (let guard = 0; guard < 8; guard += 1) {
    const next = value.replace(SUBJECT_PREFIX, '');
    if (next === value) break;
    value = next;
  }
  return value;
}

function threadKey(accountId, subject) {
  const normalized = normalizeSubject(subject).toLowerCase();
  return `${String(accountId || '')}\u0000${normalized}`;
}

function cleanText(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function normalizeRule(value, now = Date.now()) {
  if (!value || typeof value !== 'object') throw new Error('规则内容无效');
  const field = String(value.field || 'from');
  if (!RULE_FIELDS.has(field)) throw new Error('规则条件无效');
  const action = String(value.action || 'read');
  if (!RULE_ACTIONS.has(action)) throw new Error('规则动作无效');
  const needle = cleanText(value.value, 200).trim();
  if (!needle) throw new Error('请填写匹配内容');
  const id = value.id ? cleanText(value.id, 64) : '';
  return {
    id,
    name: cleanText(value.name, 60).trim() || `匹配“${needle}”`,
    enabled: value.enabled !== false,
    field,
    value: needle,
    action,
    createdAt: Number(value.createdAt) > 0 ? Number(value.createdAt) : now,
    since: Number(value.since) > 0 ? Number(value.since) : Number(value.createdAt) || now
  };
}

function ruleMatches(rule, message) {
  if (!rule || rule.enabled === false) return false;
  const messageAt = Number(message && message.timestamp) || 0;
  if (rule.since && messageAt && messageAt < Number(rule.since)) return false;
  const needle = String(rule.value || '').toLowerCase();
  if (!needle) return false;
  let haystack = '';
  if (rule.field === 'subject') {
    haystack = String(message.subject || '');
  } else if (rule.field === 'to') {
    haystack = (message.to || [])
      .map((item) => `${item.name || ''} ${item.address || ''}`)
      .join(' ');
  } else {
    haystack = `${(message.from && message.from.name) || ''} ${(message.from && message.from.address) || ''}`;
  }
  return haystack.toLowerCase().includes(needle);
}

function normalizedAddress(value) {
  return String(value == null ? '' : value).trim().toLowerCase();
}

function blacklistMatches(blacklist, message) {
  const sender = normalizedAddress(message && message.from && message.from.address);
  if (!sender) return false;
  return (Array.isArray(blacklist) ? blacklist : []).some((entry) => {
    const email = normalizedAddress(entry && entry.email ? entry.email : entry);
    if (email !== sender) return false;
    const since = Number(entry && entry.addedAt) || 0;
    const messageAt = Number(message && message.timestamp) || 0;
    return !since || !messageAt || messageAt >= since;
  });
}

/* Returns the effective action set for one message. Trash wins over archive
   because a blocked sender should never fall back into the archive folder. */
function planMessage({ rules, blacklist, message }) {
  const actions = new Set();
  let matched = [];
  if (blacklistMatches(blacklist, message)) {
    actions.add('trash');
    actions.add('read');
    return { actions: [...actions], blocked: true, rules: [] };
  }
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (!ruleMatches(rule, message)) continue;
    matched.push(rule.id || rule.name || 'rule');
    actions.add(rule.action);
  }
  if (actions.has('trash')) actions.delete('archive');
  return { actions: [...actions], blocked: false, rules: matched };
}

module.exports = {
  normalizeSubject,
  threadKey,
  normalizeRule,
  ruleMatches,
  blacklistMatches,
  planMessage,
  RULE_FIELDS,
  RULE_ACTIONS
};
