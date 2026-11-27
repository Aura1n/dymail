/* Mail provider presets. Mirrors the desktop list in src/renderer/app.js, plus per-provider
   help links (where to get the app password / auth code) shown on the add-account page. */

export const PROVIDERS = [
  { id: 'gmail', label: 'Gmail', imap: { host: 'imap.gmail.com', port: 993, secure: true }, smtp: { host: 'smtp.gmail.com', port: 465, secure: true }, oauth: 'google', passwordLabel: '应用专用密码', hint: '推荐用 Google 授权登录；也可以使用应用专用密码', noOauthHint: '此版本未开通 Google 授权登录，请使用应用专用密码（不是 Google 登录密码）', helpUrl: 'https://myaccount.google.com/apppasswords', helpLabel: '获取应用专用密码' },
  { id: 'outlook', label: 'Outlook', imap: { host: 'outlook.office365.com', port: 993, secure: true }, smtp: { host: 'smtp.office365.com', port: 587, secure: false }, oauth: 'microsoft', passwordLabel: '应用专用密码', hint: '微软已停用密码登录，请使用 Microsoft 授权登录', noOauthHint: '微软已停用密码 / 应用专用密码登录，此版本暂不支持添加 Outlook 账户，请改用其他邮箱' },
  { id: 'qq', label: 'QQ 邮箱', imap: { host: 'imap.qq.com', port: 993, secure: true }, smtp: { host: 'smtp.qq.com', port: 465, secure: true }, passwordLabel: '授权码', hint: '网页版邮箱：设置 → 账号与安全 → 安全设置，开启 IMAP/SMTP 服务后生成授权码', helpUrl: 'https://help.mail.qq.com/detail/0/985', helpLabel: '授权码获取教程（QQ 官方）' },
  { id: '163', label: '163 邮箱', imap: { host: 'imap.163.com', port: 993, secure: true }, smtp: { host: 'smtp.163.com', port: 465, secure: true }, passwordLabel: '授权码', hint: '网页版邮箱：设置 → POP3/SMTP/IMAP，开启服务并新增授权密码', helpUrl: 'https://mail.163.com', helpLabel: '去网页版生成授权码' },
  { id: '126', label: '126 邮箱', imap: { host: 'imap.126.com', port: 993, secure: true }, smtp: { host: 'smtp.126.com', port: 465, secure: true }, passwordLabel: '授权码', hint: '网页版邮箱：设置 → POP3/SMTP/IMAP，开启服务并新增授权密码', helpUrl: 'https://mail.126.com', helpLabel: '去网页版生成授权码' },
  { id: 'sina', label: '新浪', imap: { host: 'imap.sina.com', port: 993, secure: true }, smtp: { host: 'smtp.sina.com', port: 465, secure: true }, passwordLabel: '授权码', hint: '网页版邮箱：设置 → 客户端 POP/IMAP/SMTP，开启服务后生成授权码', helpUrl: 'https://mail.sina.com.cn', helpLabel: '去网页版生成授权码' },
  { id: 'aliyun', label: '阿里邮箱', imap: { host: 'imap.aliyun.com', port: 993, secure: true }, smtp: { host: 'smtp.aliyun.com', port: 465, secure: true }, passwordLabel: '密码', hint: '默认使用登录密码；若管理员开启了安全密码，在网页版「账户与安全 → 账户安全」生成', helpUrl: 'https://help.aliyun.com/zh/document_detail/444269.html', helpLabel: '安全密码获取教程（阿里云官方）' },
  { id: 'exmail', label: '企业微信邮', imap: { host: 'imap.exmail.qq.com', port: 993, secure: true }, smtp: { host: 'smtp.exmail.qq.com', port: 465, secure: true }, passwordLabel: '客户端专用密码', hint: '网页版邮箱：设置 → 邮箱绑定，生成客户端专用密码', helpUrl: 'https://exmail.qq.com', helpLabel: '去网页版生成专用密码' },
  { id: 'icloud', label: 'iCloud', imap: { host: 'imap.mail.me.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.me.com', port: 587, secure: false }, passwordLabel: 'App 专用密码', hint: '需开启双重认证后生成 App 专用密码', helpUrl: 'https://support.apple.com/zh-cn/102654', helpLabel: 'App 专用密码教程（Apple 官方）' },
  { id: 'yahoo', label: 'Yahoo', imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true }, passwordLabel: '应用密码', hint: '在账户安全页生成应用密码', helpUrl: 'https://login.yahoo.com/account/security', helpLabel: '获取应用密码' },
  { id: 'custom', label: '其他', imap: { host: '', port: 993, secure: true }, smtp: { host: '', port: 465, secure: true }, passwordLabel: '密码', hint: '手动填写 IMAP / SMTP 服务器；若邮箱要求授权码，请到对应网页版邮箱的安全设置里生成' }
];

const DOMAINS = {
  'gmail.com': 'gmail', 'googlemail.com': 'gmail',
  'outlook.com': 'outlook', 'hotmail.com': 'outlook', 'live.com': 'outlook', 'msn.com': 'outlook',
  'qq.com': 'qq', 'foxmail.com': 'qq', '163.com': '163', '126.com': '126', 'yeah.net': '126',
  'sina.com': 'sina', 'aliyun.com': 'aliyun', 'icloud.com': 'icloud', 'me.com': 'icloud',
  'yahoo.com': 'yahoo'
};

export function providerById(id) {
  return PROVIDERS.find((item) => item.id === id) || PROVIDERS[PROVIDERS.length - 1];
}

export function providerForEmail(email) {
  const domain = String(email || '').split('@')[1];
  return domain ? DOMAINS[domain.toLowerCase()] || null : null;
}
