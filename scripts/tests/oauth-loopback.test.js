'use strict';
/* 不联网，模拟 Google 的令牌端点，跑通回环回调 + PKCE + 令牌交换。 */
process.env.DYMAIL_GOOGLE_CLIENT_ID = 'test-client';
process.env.DYMAIL_GOOGLE_CLIENT_SECRET = 'test-secret';

const http = require('node:http');
const assert = require('node:assert');
const { authorize, refreshTokens } = require('../../src/main/oauth');

const claims = Buffer.from(JSON.stringify({ email: 'tester@gmail.com', name: 'Tester' })).toString('base64url');
const idToken = `x.${claims}.y`;

let sawExchange = false;

global.fetch = async (url, options) => {
  const text = String(url);
  if (!text.includes('oauth2.googleapis.com/token')) throw new Error(`unexpected url ${text}`);
  const body = new URLSearchParams(String(options.body));
  if (body.get('grant_type') === 'authorization_code') {
    sawExchange = true;
    assert.equal(body.get('client_id'), 'test-client');
    assert.equal(body.get('client_secret'), 'test-secret');
    assert.equal(body.get('code'), 'authcode');
    assert.ok(body.get('redirect_uri').startsWith('http://127.0.0.1:'));
    assert.ok(body.get('code_verifier').length >= 43, 'PKCE verifier missing');
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, id_token: idToken, scope: 'scope-a' })
    };
  }
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'rt-1');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ access_token: 'at-2', expires_in: 3600 })
    };
};

(async () => {
  const result = await authorize('google', async (authUrl) => {
    const url = new URL(authUrl);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('access_type'), 'offline');
    assert.equal(url.searchParams.get('prompt'), 'consent');
    assert.equal(url.searchParams.get('client_id'), 'test-client');
    const redirect = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    assert.ok(state);
    setImmediate(() => {
      http.get(`${redirect}?code=authcode&state=${state}`, (res) => {
        assert.equal(res.statusCode, 200);
        res.resume();
      });
    });
  });
  assert.equal(result.email, 'tester@gmail.com');
  assert.equal(result.name, 'Tester');
  assert.equal(result.accessToken, 'at-1');
  assert.equal(result.refreshToken, 'rt-1');
  assert.ok(sawExchange, 'token exchange never ran');

  const refreshed = await refreshTokens('google', 'rt-1');
  assert.equal(refreshed.accessToken, 'at-2');
  assert.equal(refreshed.refreshToken, 'rt-1', 'refresh token should be kept when not rotated');

  console.log('oauth loopback + PKCE + refresh OK');
})().catch((err) => {
  console.error('FAILED:', err);
  process.exitCode = 1;
});
