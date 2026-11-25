'use strict';
/* Runs in the real Electron runtime: OAuth account persistence, encryption and token rotation. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app } = require('electron');

const userData = path.join(os.tmpdir(), 'dymail-tests', 'store-oauth');
fs.rmSync(userData, { recursive: true, force: true });
app.setPath('userData', userData);

app.whenReady().then(() => {
  try {
    const { Store } = require('../../src/main/store');
    const store = new Store();
    const imap = { host: 'imap.gmail.com', port: 993, secure: true };
    const smtp = { host: 'smtp.gmail.com', port: 465, secure: true };

    const saved = store.saveAccount(
      { email: 'tester@gmail.com', name: 'Tester', imap, smtp, authType: 'oauth2' },
      null,
      { provider: 'google', email: 'tester@gmail.com', scope: 'scope-a', accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: Date.now() + 3600000 }
    );
    assert.equal(saved.authType, 'oauth2');
    assert.equal(saved.hasPassword, false);
    assert.equal(saved.hasOAuth, true);
    assert.equal(saved.oauthProvider, 'google');

    const first = store.getOAuthRecord(saved.id);
    assert.equal(first.accessToken, 'access-1');
    assert.equal(first.refreshToken, 'refresh-1');

    /* 刷新后 Microsoft 风格的令牌轮换：refresh token 覆盖，Scope 保留。 */
    store.updateOAuth(saved.id, { provider: 'google', accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: Date.now() + 7200000, scope: 'scope-b' });
    const second = store.getOAuthRecord(saved.id);
    assert.equal(second.accessToken, 'access-2');
    assert.equal(second.refreshToken, 'refresh-2');
    assert.equal(second.scope, 'scope-b');

    const raw = fs.readFileSync(store.file, 'utf8');
    assert.ok(!raw.includes('access-2'), 'access token stored in plaintext');
    assert.ok(!raw.includes('refresh-2'), 'refresh token stored in plaintext');

    /* 切回密码登录时必须清掉 OAuth 凭据，避免留下失效的秘密。 */
    const passwordAccount = store.saveAccount({ id: saved.id, email: 'tester@gmail.com', name: 'Tester', imap, smtp, authType: 'password' }, 'hunter2');
    assert.equal(passwordAccount.authType, 'password');
    assert.equal(passwordAccount.hasOAuth, false);
    assert.equal(store.getPassword(saved.id), 'hunter2');
    assert.equal(store.getOAuthRecord(saved.id), null);

    /* 旧的纯密码记录（没有 authType 字段）要按密码账户正常读取。 */
    const legacy = store.saveAccount({ email: 'legacy@qq.com', name: 'Old', imap: { host: 'imap.qq.com', port: 993, secure: true }, smtp: { host: 'smtp.qq.com', port: 465, secure: true } }, 'code-1');
    assert.equal(legacy.authType, 'password');
    assert.equal(store.getPassword(legacy.id), 'code-1');

    console.log('store oauth persistence OK');
    app.exit(0);
  } catch (err) {
    console.error('FAILED:', err);
    app.exit(1);
  }
});
