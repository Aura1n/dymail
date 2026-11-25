'use strict';

/* OAuth 2.0 授权码 + PKCE，走本地回环地址接收回调。
   只依赖 node:http / node:crypto，浏览器由外部注入的 openUrl 打开，方便单独测试。

   令牌的加密与落盘由 Store 负责：本模块只负责拿到令牌、以及在过期前刷新，
   永远不把令牌交给渲染层。 */

const http = require('node:http');
const crypto = require('node:crypto');
const CLIENTS = require('./oauth-config');

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;
const HTTP_TIMEOUT_MS = 20 * 1000;
/* 提前 3 分钟刷新，避免一条长命令执行到一半令牌刚好过期。 */
const REFRESH_MARGIN_MS = 3 * 60 * 1000;

const PROVIDERS = {
  google: {
    id: 'google',
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    redirectBase: 'http://127.0.0.1',
    redirectPath: '/oauth2callback',
    scope: 'openid email profile https://mail.google.com/',
    wantsOffline: true
  },
  microsoft: {
    id: 'microsoft',
    label: 'Microsoft',
    tenant: 'common',
    authorizeUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
    userInfoUrl: '',
    redirectBase: 'http://localhost',
    redirectPath: '/oauth2callback',
    /* IMAP/SMTP 用 outlook.office.com 的作用域；Graph 的 Mail.ReadWrite 不能直接
       用于 IMAP，两者不能混用。 */
    scope:
      'offline_access openid profile email https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
    wantsOffline: false
  }
};

const REAUTHORIZE_HINT = '请在账户设置中重新授权';

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function challengeFor(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

function endpoint(template, provider) {
  return template.replace('{tenant}', provider.tenant || 'common');
}

function clientFor(providerKey) {
  return CLIENTS[providerKey] || {};
}

function requireClient(providerKey) {
  const provider = PROVIDERS[providerKey];
  if (!provider) throw new Error('不支持的 OAuth 登录方式');
  const client = clientFor(providerKey);
  if (!client.clientId) {
    throw new Error(`尚未配置 ${provider.label} OAuth 客户端 ID，请先在 src/main/oauth-config.js 中填写`);
  }
  return { provider, client };
}

function describeAuthError(code) {
  const map = {
    access_denied: '已取消授权',
    admin_consent_required: '该组织的管理员尚未允许此应用访问邮箱',
    consent_required: '需要管理员同意后才能使用该账户登录',
    invalid_request: '授权请求无效，请重试',
    unauthorized_client: '该应用未被允许使用这种方式登录'
  };
  return map[String(code)] || `授权失败（${code || '未知错误'}）`;
}

function describeRefreshError(err) {
  const code = String((err && err.code) || '');
  if (code === 'invalid_grant') return `OAuth 授权已失效，${REAUTHORIZE_HINT}`;
  if (code === 'invalid_client') return 'OAuth 客户端配置有误，请检查 client ID 与密钥';
  if (code === 'unauthorized_client') return '该应用未被允许刷新授权，请重新授权';
  return err && err.message ? String(err.message) : '刷新授权失败，请重新授权';
}

/* 授权页和错误页都只是本地提示，不需要脚本，避免在回环页面上开放任何能力。 */
function callbackPage(success, message) {
  const title = success ? '授权成功' : '授权未完成';
  const color = success ? '#1a7f37' : '#b42318';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${title}</title><style>
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#f5f5f7;color:#1d1d1f;font:15px/1.6 "Segoe UI","Microsoft YaHei",sans-serif}
.card{background:#fff;border-radius:14px;padding:36px 40px;box-shadow:0 8px 28px rgba(0,0,0,.08);
max-width:420px;text-align:center}
h1{margin:0 0 10px;font-size:19px;color:${color}}
p{margin:0;color:#55586e}
</style></head><body><div class="card"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

async function postForm(url, params) {
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
    });
  } catch {
    throw new Error(`无法连接 ${new URL(url).host}，请检查网络或代理设置`);
  }
  const raw = await response.text();
  let data = {};
  try {
    data = JSON.parse(raw);
  } catch {
    data = {};
  }
  if (!response.ok) {
    const error = new Error(String(data.error_description || '').slice(0, 240) || `授权服务返回 ${response.status}`);
    error.code = String(data.error || response.status);
    throw error;
  }
  return data;
}

function identityFromIdToken(idToken) {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const email = payload.email || payload.preferred_username || payload.upn || '';
    if (!email) return null;
    return { email: String(email).trim(), name: String(payload.name || '').trim() };
  } catch {
    return null;
  }
}

async function googleProfile(accessToken) {
  const response = await fetch(PROVIDERS.google.userInfoUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('无法读取 Google 账户信息，请重试');
  const data = await response.json();
  return { email: String(data.email || '').trim(), name: String(data.name || '').trim() };
}

function buildAuthUrl(provider, client, redirectUri, state, challenge) {
  const url = new URL(endpoint(provider.authorizeUrl, provider));
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', provider.scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (provider.wantsOffline) {
    /* Google 的 refresh token 只在首次授权或 prompt=consent 时下发，重新授权也要带上。 */
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
  }
  return url.toString();
}

/* 监听回环端口直到收到回调。端口交给系统分配，桌面客户端的回环重定向允许多个端口。 */
function waitForCallback(provider, { state, buildUrl, openUrl }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = null;
    const server = http.createServer();

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        server.close();
      } catch {}
      if (err) reject(err);
      else resolve(value);
    };

    const reply = (res, success, message) => {
      try {
        res.writeHead(success ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(callbackPage(success, message));
      } catch {}
    };

    server.on('error', (err) => finish(err));
    server.on('request', (req, res) => {
      let url;
      try {
        url = new URL(req.url, 'http://127.0.0.1');
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (url.pathname !== provider.redirectPath) {
        res.writeHead(404);
        res.end();
        return;
      }
      const error = url.searchParams.get('error');
      if (error) {
        const message = describeAuthError(error);
        reply(res, false, message);
        finish(new Error(message));
        return;
      }
      if (url.searchParams.get('state') !== state) {
        reply(res, false, '授权状态校验失败，请重新发起登录');
        finish(new Error('授权状态校验失败，请重新发起登录'));
        return;
      }
      const code = url.searchParams.get('code');
      if (!code) {
        reply(res, false, '授权回调缺少 code 参数');
        finish(new Error('授权回调缺少 code 参数'));
        return;
      }
      const redirectUri = `${provider.redirectBase}:${server.address().port}${provider.redirectPath}`;
      reply(res, true, '授权成功，可以关闭此窗口返回 Dymail');
      finish(null, { code, redirectUri });
    });

    timer = setTimeout(() => finish(new Error('登录超时，请重新尝试')), AUTH_TIMEOUT_MS);

    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `${provider.redirectBase}:${server.address().port}${provider.redirectPath}`;
      Promise.resolve(openUrl(buildUrl(redirectUri))).catch((err) => finish(err));
    });
  });
}

function normalizeTokenResponse(data, provider, previousRefreshToken = '') {
  return {
    provider: provider.id,
    accessToken: String(data.access_token || ''),
    /* Microsoft 每次刷新都会换发新的 refresh token，旧的随即失效，必须覆盖保存。 */
    refreshToken: String(data.refresh_token || previousRefreshToken || ''),
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    scope: String(data.scope || provider.scope)
  };
}

async function refreshTokens(providerKey, refreshToken) {
  const { provider, client } = requireClient(providerKey);
  const params = {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.clientId
  };
  if (client.clientSecret) params.client_secret = client.clientSecret;
  const data = await postForm(endpoint(provider.tokenUrl, provider), params);
  if (!data.access_token) throw new Error(`刷新授权失败，${REAUTHORIZE_HINT}`);
  return normalizeTokenResponse(data, provider, refreshToken);
}

async function authorize(providerKey, openUrl) {
  const { provider, client } = requireClient(providerKey);
  const state = base64url(crypto.randomBytes(24));
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = challengeFor(verifier);

  const callback = await waitForCallback(provider, {
    state,
    openUrl,
    buildUrl: (redirectUri) => buildAuthUrl(provider, client, redirectUri, state, challenge)
  });

  const params = {
    grant_type: 'authorization_code',
    code: callback.code,
    client_id: client.clientId,
    redirect_uri: callback.redirectUri,
    code_verifier: verifier
  };
  if (client.clientSecret) params.client_secret = client.clientSecret;
  const data = await postForm(endpoint(provider.tokenUrl, provider), params);
  if (!data.access_token) throw new Error(`${provider.label} 未返回访问令牌，请重试`);

  const profile = identityFromIdToken(data.id_token) || (provider.id === 'google' ? await googleProfile(data.access_token) : null);
  if (!profile || !profile.email) throw new Error('无法获取授权账号的邮箱地址，请确认已允许读取账号信息');

  const tokens = normalizeTokenResponse(data, provider);
  if (!tokens.refreshToken) {
    throw new Error('未获取到长期授权，请重试并在授权页允许离线访问');
  }
  return { ...tokens, email: profile.email, name: profile.name };
}

class OAuthService {
  constructor(store, options = {}) {
    this.store = store;
    this.openUrl = typeof options.openUrl === 'function' ? options.openUrl : defaultOpenUrl;
    this.inflight = new Map();
  }

  authorize(providerKey) {
    return authorize(providerKey, this.openUrl);
  }

  /* 每次连接前取一个可用的 access token；并发调用共用同一次刷新，避免刷新令牌被
     两个请求各用一次而互相作废。 */
  accessToken(accountId) {
    if (this.inflight.has(accountId)) return this.inflight.get(accountId);
    const task = this._accessToken(accountId).finally(() => this.inflight.delete(accountId));
    this.inflight.set(accountId, task);
    return task;
  }

  async _accessToken(accountId) {
    const record = this.store.getOAuthRecord(accountId);
    if (!record) throw new Error(`该账户尚未完成 OAuth 授权，${REAUTHORIZE_HINT}`);
    if (record.accessToken && record.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
      return record.accessToken;
    }
    if (!record.refreshToken) throw new Error(`OAuth 授权已失效，${REAUTHORIZE_HINT}`);
    let tokens;
    try {
      tokens = await refreshTokens(record.provider, record.refreshToken);
    } catch (err) {
      throw new Error(describeRefreshError(err));
    }
    this.store.updateOAuth(accountId, tokens);
    return tokens.accessToken;
  }
}

function defaultOpenUrl(url) {
  const { shell } = require('electron');
  return shell.openExternal(url);
}

module.exports = {
  OAuthService,
  authorize,
  refreshTokens,
  describeRefreshError,
  PROVIDERS,
  REAUTHORIZE_HINT
};
