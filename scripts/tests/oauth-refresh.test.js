'use strict';
process.env.DYMAIL_GOOGLE_CLIENT_ID = 'test-client';
process.env.DYMAIL_GOOGLE_CLIENT_SECRET = 'test-secret';

const assert = require('node:assert');
const { OAuthService } = require('../../src/main/oauth');

let fetchCount = 0;
let stores = 0;

global.fetch = async (url, options) => {
  const body = new URLSearchParams(String(options.body));
  assert.equal(body.get('grant_type'), 'refresh_token');
  assert.equal(body.get('refresh_token'), 'refresh-old');
  fetchCount += 1;
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ access_token: `at-${fetchCount}`, expires_in: 3600, refresh_token: 'refresh-new' })
  };
};

class FakeStore {
  constructor(record) {
    this.record = record;
  }
  getOAuthRecord() {
    return this.record;
  }
  updateOAuth(id, tokens) {
    stores += 1;
    this.record = { ...this.record, ...tokens };
  }
}

(async () => {
  /* 过期令牌：触发一次刷新，并把轮换后的 refresh token 写回。 */
  const expired = new FakeStore({
    provider: 'google',
    email: 'a@gmail.com',
    scope: 's',
    expiresAt: Date.now() - 1000,
    accessToken: 'at-old',
    refreshToken: 'refresh-old'
  });
  const service = new OAuthService(expired, { openUrl: async () => {} });
  const token = await service.accessToken('acc');
  assert.equal(token, 'at-1');
  assert.equal(fetchCount, 1);
  assert.equal(stores, 1);
  assert.equal(expired.record.refreshToken, 'refresh-new');

  /* 仍有 3 分钟以上有效期：直接用缓存，不再刷新。 */
  const fresh = new FakeStore({
    provider: 'google',
    email: 'a@gmail.com',
    scope: 's',
    expiresAt: Date.now() + 10 * 60 * 1000,
    accessToken: 'at-fresh',
    refreshToken: 'refresh-old'
  });
  const service2 = new OAuthService(fresh, { openUrl: async () => {} });
  assert.equal(await service2.accessToken('acc'), 'at-fresh');
  assert.equal(fetchCount, 1);

  /* 并发取令牌只应触发一次刷新。 */
  const parallel = new FakeStore({
    provider: 'google',
    email: 'a@gmail.com',
    scope: 's',
    expiresAt: 0,
    accessToken: '',
    refreshToken: 'refresh-old'
  });
  const service3 = new OAuthService(parallel, { openUrl: async () => {} });
  const results = await Promise.all([service3.accessToken('acc'), service3.accessToken('acc'), service3.accessToken('acc')]);
  assert.deepEqual(results, ['at-2', 'at-2', 'at-2']);
  assert.equal(fetchCount, 2);

  console.log('oauth token refresh + caching OK');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
