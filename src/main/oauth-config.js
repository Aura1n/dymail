'use strict';

/* OAuth 客户端注册信息。
   桌面（public）客户端拿不到真正的秘密，这里的 clientId / clientSecret 可以随
   安装包分发。发版前把下面两项填成你自己注册的值，本地调试也可以用环境变量
   覆盖，避免把开发用 ID 提交进仓库。

   Google：Cloud Console -> OAuth 同意屏幕（外部，测试阶段需把账号加入测试用户）
           -> 凭据 -> 创建「桌面应用」客户端。作用域含 https://mail.google.com/，
           属于受限作用域，公开发布需要通过 Google 的验证流程。
   Microsoft：Entra 管理中心 -> 应用注册 -> 平台选「移动和桌面应用」，
           重定向 URI 填 http://localhost，支持任意端口。 */

const googleId = process.env.DYMAIL_GOOGLE_CLIENT_ID || '';
const googleSecret = process.env.DYMAIL_GOOGLE_CLIENT_SECRET || '';
const microsoftId = process.env.DYMAIL_MICROSOFT_CLIENT_ID || '';
const microsoftTenant = process.env.DYMAIL_MICROSOFT_TENANT || 'common';

module.exports = {
  google: {
    clientId: googleId,
    clientSecret: googleSecret
  },
  microsoft: {
    clientId: microsoftId,
    tenant: microsoftTenant
  }
};
