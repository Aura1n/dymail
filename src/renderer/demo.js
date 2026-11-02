const NOW = Date.now();
const mins = (value) => new Date(NOW - value * 60000).toISOString();
const hours = (value) => mins(value * 60);
const days = (value) => hours(value * 24);

const FOLDER_PATHS = {
  inbox: 'INBOX',
  sent: 'Sent',
  junk: 'Junk',
  trash: 'Trash',
  archive: 'Archive',
  drafts: 'Drafts'
};

const FOLDER_NAMES = {
  inbox: 'Inbox',
  sent: 'Sent',
  junk: 'Junk',
  trash: 'Trash',
  archive: 'Archive',
  drafts: 'Drafts'
};

const accounts = [
  {
    id: 'acc-work',
    email: 'lin.chen@outlook.com',
    name: '林辰',
    color: '#0a84ff',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    createdAt: days(430)
  },
  {
    id: 'acc-gmail',
    email: 'linchen@gmail.com',
    name: '',
    color: '#34a853',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    createdAt: days(210)
  },
  {
    id: 'acc-qq',
    email: 'lin.chen@qq.com',
    name: '',
    color: '#ff9f0a',
    imap: { host: 'imap.qq.com', port: 993, secure: true },
    smtp: { host: 'smtp.qq.com', port: 465, secure: true },
    createdAt: days(96)
  }
];

let uidSeed = 1000;

function message(data) {
  uidSeed += 1;
  return {
    uid: uidSeed,
    seen: false,
    flagged: false,
    to: [],
    cc: [],
    bcc: [],
    attachments: [],
    html: '',
    text: '',
    ...data
  };
}

const boxes = {
  'acc-work': {
    inbox: [
      message({
        subject: '本周产品评审安排',
        from: { name: '王婷', address: 'wangting@northwind.cn' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: mins(38),
        text: '林辰，\n\n本周评审定在周三上午 10:00，会议室 A。需要提前准备三部分内容：\n\n1. 邮件列表的加载状态\n2. 阅读页的窄屏表现\n3. 草稿自动保存的边界情况\n\n材料请在周二下班前发我。\n\n王婷',
        html: `<p>林辰，</p><p>本周评审定在周三上午 10:00，会议室 A。需要提前准备三部分内容：</p><ol><li>邮件列表的加载状态</li><li>阅读页的窄屏表现</li><li>草稿自动保存的边界情况</li></ol><p>材料请在周二下班前发我。</p><p>王婷</p>`
      }),
      message({
        subject: '[dymail] 2 new pull requests',
        from: { name: 'GitHub', address: 'notifications@github.com' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: hours(2),
        html: `<p><strong>dymail</strong> 有 2 个新的 Pull Request 等待审核。</p>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:8px 0;border-bottom:1px solid #eee"><a href="https://github.com/">#148 修正搜索范围内的空格处理</a><br><span style="color:#777;font-size:12px">opened by yuhan · 3 commits · +42 −11</span></td></tr>
            <tr><td style="padding:8px 0"><a href="https://github.com/">#147 统一文件夹未读数的刷新时机</a><br><span style="color:#777;font-size:12px">opened by mika · 1 commit · +18 −4</span></td></tr>
          </table>`,
        text: 'dymail 有 2 个新的 Pull Request 等待审核。\n\n#148 修正搜索范围内的空格处理\n#147 统一文件夹未读数的刷新时机'
      }),
      message({
        subject: '9 月报销发票已开具',
        from: { name: '财务中心', address: 'finance@northwind.cn' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: days(1) ,
        seen: true,
        attachments: [
          { name: '发票-202609-1284.pdf', size: 223410, contentType: 'application/pdf' },
          { name: '报销明细.xlsx', size: 48121, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
        ],
        text: '林辰，9 月差旅报销的发票已开具，随邮件附上电子发票和明细，请查收。金额 1,284.00 元。',
        html: `<p>林辰，</p><p>9 月差旅报销的发票已开具，随邮件附上电子发票和明细，请查收。</p><p>金额：<strong>1,284.00 元</strong></p><p>财务中心</p>`
      }),
      message({
        subject: 'Design review — 邮件列表状态与空态',
        from: { name: '李昂', address: 'liang@northwind.cn' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: days(2),
        seen: true,
        flagged: true,
        html: `<p>把列表的四种状态整理在一起了：</p>
          <ul>
            <li><strong>加载中：</strong>只保留两行骨架，避免闪动。</li>
            <li><strong>空文件夹：</strong>不出现按钮，只提示当前没有邮件。</li>
            <li><strong>未读筛选：</strong>顶部保留入口，随时可以退出筛选。</li>
            <li><strong>同步失败：</strong>列表上方一条窄提示，可点击重试。</li>
          </ul>
          <p>另外建议选中行不要加左侧色条，用底色已经足够。</p>`,
        text: '把列表的四种状态整理在一起了：\n\n加载中、空文件夹、未读筛选、同步失败。\n\n另外建议选中行不要加左侧色条，用底色已经足够。'
      }),
      message({
        subject: 'Figma 评论：Settings / v3',
        from: { name: 'Figma', address: 'notifications@figma.com' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: days(1),
        flagged: true,
        html: `<p><strong>周谨</strong> 在 <em>Settings / v3</em> 中回复了你：</p>
          <img src="https://images.unsplash.com/photo-1558655146-9f40138edfeb?w=720&q=80" alt="" width="560" style="border-radius:8px">
          <p>“账户区块的间距再收紧一点，和左侧导航对齐。” </p>
          <p><a href="https://www.figma.com/">在 Figma 中查看</a></p>`,
        text: '周谨 在 Settings / v3 中回复了你：“账户区块的间距再收紧一点，和左侧导航对齐。”'
      }),
      message({
        subject: 'Northwind 每周精选',
        from: { name: 'Northwind', address: 'news@northwind.cn' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: days(1),
        html: `<table width="600" cellpadding="0" cellspacing="0" style="width:600px;min-width:600px;background:#f4f6fa">
          <tr><td style="width:600px;padding:18px">
            <div style="min-width:600px">
              <p><strong>每周精选</strong>：固定 600 宽的推广邮件，窄窗口下应跟着收缩。</p>
              <img src="https://picsum.photos/600/140" width="600" alt="" style="width:600px">
              <p style="word-break:normal">averyveryverylongunbrokentoken-thatshouldnotoverflowthereadingpane.example.com/path</p>
            </div>
          </td></tr>
        </table>`,
        text: '每周精选：固定 600 宽的推广邮件，窄窗口下应跟着收缩。'
      }),
      message({
        subject: 'Microsoft 365 服务运行状态',
        from: { name: 'Microsoft 365', address: 'office365@microsoft.com' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: days(3),
        seen: true,
        text: '过去 24 小时内所有服务运行正常。如需查看详细历史记录，请访问服务运行状态页面。'
      })
    ],
    sent: [
      message({
        subject: 'Re: 本周产品评审安排',
        from: { name: '林辰', address: 'lin.chen@outlook.com' },
        to: [{ name: '王婷', address: 'wangting@northwind.cn' }],
        date: mins(26),
        seen: true,
        html: '<p>收到，周三上午我会带材料过去。</p><p>林辰</p>',
        text: '收到，周三上午我会带材料过去。\n\n林辰'
      }),
      message({
        subject: 'Re: Design review — 邮件列表状态与空态',
        from: { name: '林辰', address: 'lin.chen@outlook.com' },
        to: [{ name: '李昂', address: 'liang@northwind.cn' }],
        date: days(1),
        seen: true,
        html: '<p>选中行的左侧色条已经去掉。空态文案我再过一遍。</p><p>林辰</p>',
        text: '选中行的左侧色条已经去掉。空态文案我再过一遍。'
      }),
      message({
        subject: '十月排期',
        from: { name: '林辰', address: 'lin.chen@outlook.com' },
        to: [{ name: '王婷', address: 'wangting@northwind.cn' }],
        date: days(6),
        seen: true,
        text: '十月主要做三件事：搜索体验、草稿同步、窄屏适配。'
      })
    ],
    junk: [
      message({
        subject: '限时优惠：企业邮箱升级',
        from: { name: 'Mail Promo', address: 'promo@example.net' },
        date: days(2),
        seen: true,
        text: '升级企业邮箱，享受更大容量。'
      }),
      message({
        subject: '您有一份新的问卷待填写',
        from: { name: 'Survey', address: 'noreply@survey.example' },
        date: days(4),
        text: '完成问卷即可获得礼品。'
      })
    ],
    trash: [
      message({
        subject: '上周周报（旧版本）',
        from: { name: '林辰', address: 'lin.chen@outlook.com' },
        to: [{ name: '王婷', address: 'wangting@northwind.cn' }],
        date: days(8),
        seen: true,
        text: '这是被新版本替换的周报。'
      }),
      message({
        subject: '会议室 A 预约确认',
        from: { name: '行政服务台', address: 'admin@northwind.cn' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: days(45),
        seen: true,
        text: '您预约的会议室 A 已过期，如需使用请重新预约。'
      })
    ],
    archive: [
      message({
        subject: '2026 Q2 项目复盘',
        from: { name: '王婷', address: 'wangting@northwind.cn' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: days(24),
        seen: true,
        html: '<p>复盘纪要已归档，重点结论在文档第一节。</p><p>王婷</p>',
        text: '复盘纪要已归档，重点结论在文档第一节。'
      }),
      message({
        subject: '旧版设计规范 v2',
        from: { name: '李昂', address: 'liang@northwind.cn' },
        to: [{ name: '林辰', address: 'lin.chen@outlook.com' }],
        date: days(48),
        seen: true,
        text: 'v2 规范留档，后续以 v3 为准。'
      })
    ]
  },
  'acc-gmail': {
    inbox: [
      message({
        subject: '新的登录活动',
        from: { name: 'Google', address: 'no-reply@accounts.google.com' },
        to: [{ name: '林辰', address: 'linchen@gmail.com' }],
        date: hours(3),
        email: 'linchen@gmail.com',
        html: `<p>您的 Google 账号刚刚在新设备上登录。</p>
          <table style="border-collapse:collapse">
            <tr><td style="padding:4px 16px 4px 0;color:#777">设备</td><td>Windows · Chrome</td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#777">时间</td><td>今天 07:26</td></tr>
            <tr><td style="padding:4px 16px 4px 0;color:#777">位置</td><td>上海</td></tr>
          </table>
          <p>如果这是您本人操作，可以忽略此邮件。</p>`,
        text: '您的 Google 账号刚刚在新设备上登录。设备：Windows · Chrome，时间：今天 07:26，位置：上海。'
      }),
      message({
        subject: 'Your payout summary',
        from: { name: 'Stripe', address: 'notifications@stripe.com' },
        to: [{ name: 'Lin Chen', address: 'linchen@gmail.com' }],
        date: days(1),
        seen: true,
        flagged: true,
        html: `<p>A payout of <strong>$1,842.60</strong> was sent to your bank account.</p>
          <p style="color:#777;font-size:12px">Expected arrival: 2 business days</p>`,
        text: 'A payout of $1,842.60 was sent to your bank account. Expected arrival: 2 business days.'
      }),
      message({
        subject: '少数派日报：效率工具精选',
        from: { name: '少数派', address: 'daily@sspai.com' },
        to: [{ name: '林辰', address: 'linchen@gmail.com' }],
        date: days(1),
        html: `<h3 style="margin:0 0 10px">今天值得一读</h3>
          <p><strong>重新整理你的桌面文件</strong><br><span style="color:#666">用一套简单的命名规则，让每周归档不再拖延。</span></p>
          <p><strong>键盘优先的邮件工作流</strong><br><span style="color:#666">从筛选到归档，尽量不碰鼠标。</span></p>`,
        text: '今天值得一读：重新整理你的桌面文件；键盘优先的邮件工作流。'
      }),
      message({
        subject: '本周团队更新',
        from: { name: 'Notion', address: 'team@makenotion.com' },
        to: [{ name: '林辰', address: 'linchen@gmail.com' }],
        date: days(4),
        seen: true,
        text: '本周团队空间新增 6 个页面，3 条评论待处理。'
      })
    ],
    sent: [
      message({
        subject: '行程确认',
        from: { name: '林辰', address: 'linchen@gmail.com' },
        to: [{ name: 'Hotel Front Desk', address: 'front@example-hotel.com' }],
        date: days(3),
        seen: true,
        text: 'Confirming arrival on the 18th, one king room for two nights. Thank you.'
      })
    ],
    junk: [
      message({
        subject: 'You have 1 new reward',
        from: { name: 'Rewards', address: 'win@example.org' },
        date: days(3),
        text: 'Claim your reward now.'
      })
    ],
    trash: [
      message({
        subject: 'Ticket #4402 closed as duplicate',
        from: { name: 'Support Desk', address: 'support@example-cloud.com' },
        to: [{ name: 'Lin Chen', address: 'linchen@gmail.com' }],
        date: days(6),
        seen: true,
        text: 'This ticket was merged into #4398.'
      }),
      message({
        subject: 'Re: hotel booking',
        from: { name: 'Reservation Desk', address: 'stay@example-hotel.com' },
        to: [{ name: 'Lin Chen', address: 'linchen@gmail.com' }],
        date: days(7),
        seen: true,
        text: 'The second reservation has been cancelled.'
      }),
      message({
        subject: 'Wrong draft of the contract',
        from: { name: 'Li Ang', address: 'liang@northwind.cn' },
        to: [{ name: 'Lin Chen', address: 'linchen@gmail.com' }],
        date: days(11),
        seen: true,
        text: 'Ignore this copy, the signed version is in the shared drive.'
      }),
      message({
        subject: 'Old security alert',
        from: { name: 'Google', address: 'no-reply@accounts.google.com' },
        to: [{ name: 'Lin Chen', address: 'linchen@gmail.com' }],
        date: days(31),
        seen: true,
        text: 'A sign-in from an old device was blocked.'
      })
    ],
    archive: [
      message({
        subject: 'Invoice #2026-0311',
        from: { name: 'Cloud Host', address: 'billing@example-cloud.com' },
        to: [{ name: 'Lin Chen', address: 'linchen@gmail.com' }],
        date: days(30),
        seen: true,
        text: 'Invoice #2026-0311 has been paid. Amount: $24.00.'
      })
    ]
  },
  'acc-qq': {
    inbox: [
      message({
        subject: '您的快件已签收',
        from: { name: '顺丰速运', address: 'service@sf-express.com' },
        to: [{ name: '林辰', address: 'lin.chen@qq.com' }],
        date: mins(95),
        html: `<p>您的快件 <strong>SF1438291042</strong> 已由本人签收。</p>
          <p style="color:#777">签收时间：今天 08:42<br>派送员：李师傅</p>`,
        text: '您的快件 SF1438291042 已由本人签收。签收时间：今天 08:42。'
      }),
      message({
        subject: 'ECS 实例续费提醒',
        from: { name: '阿里云', address: 'message@aliyun.com' },
        to: [{ name: '林辰', address: 'lin.chen@qq.com' }],
        date: days(2),
        flagged: true,
        html: `<p>您有 1 台 ECS 实例将在 7 天后到期。</p>
          <p>实例：i-2ze8x9k3<br>地域：华东 1（杭州）<br>到期时间：11 月 8 日</p>
          <p><a href="https://www.aliyun.com/">前往控制台续费</a></p>`,
        text: '您有 1 台 ECS 实例将在 7 天后到期。实例 i-2ze8x9k3，华东 1（杭州）。'
      }),
      message({
        subject: '论文修改意见',
        from: { name: '陈老师', address: 'chen@university.edu.cn' },
        to: [{ name: '林辰', address: 'lin.chen@qq.com' }],
        date: days(5),
        seen: true,
        text: '林辰，\n\n第三章的论证还需要补充两组对照数据，参考文献格式也统一一下。修改稿下周一发我。\n\n陈老师',
        html: '<p>林辰，</p><p>第三章的论证还需要补充两组对照数据，参考文献格式也统一一下。修改稿下周一发我。</p><p>陈老师</p>'
      }),
      message({
        subject: '订单已发货',
        from: { name: '京东', address: 'order@jd.com' },
        to: [{ name: '林辰', address: 'lin.chen@qq.com' }],
        date: days(6),
        seen: true,
        text: '您的订单已从上海仓发出，预计明天送达。'
      })
    ],
    sent: [
      message({
        subject: 'Re: 论文修改意见',
        from: { name: '林辰', address: 'lin.chen@qq.com' },
        to: [{ name: '陈老师', address: 'chen@university.edu.cn' }],
        date: days(4),
        seen: true,
        text: '好的，我补完数据后周一发给您。'
      })
    ],
    junk: [],
    trash: [
      message({
        subject: '积分即将过期',
        from: { name: '会员中心', address: 'member@example.com' },
        date: days(9),
        seen: true,
        text: '您的积分将在月底过期。'
      }),
      message({
        subject: '旧账单流水',
        from: { name: '账单通知', address: 'billing@example.com' },
        date: days(61),
        seen: true,
        text: '该笔账单已结清，流水留档备查。'
      })
    ],
    archive: [
      message({
        subject: '毕业材料清单',
        from: { name: '陈老师', address: 'chen@university.edu.cn' },
        to: [{ name: '林辰', address: 'lin.chen@qq.com' }],
        date: days(40),
        seen: true,
        text: '材料清单见附件，按顺序准备即可。'
      })
    ]
  }
};

const drafts = [
  {
    id: 'draft-work-1',
    accountId: 'acc-work',
    kind: 'reply',
    to: '王婷 <wangting@northwind.cn>',
    cc: '',
    bcc: '',
    subject: 'Re: 本周产品评审安排',
    html: '<p>周三上午可以，我把三种加载状态也一起带上。</p><p>另外窄屏下阅读页的头部可能还要再收一行，现场确认。</p><div class="dymail-signature">林辰<br>产品设计 · 北风科技</div>',
    inReplyTo: '',
    references: '',
    attachments: [],
    updatedAt: mins(17)
  },
  {
    id: 'draft-work-2',
    accountId: 'acc-work',
    kind: 'new',
    to: '',
    cc: '',
    bcc: '',
    subject: '十月预算明细',
    html: '<p>预算分三块：</p><ul><li>设计工具订阅</li><li>外部评审</li><li>差旅</li></ul><p>下午补齐数字。</p>',
    inReplyTo: '',
    references: '',
    attachments: [{ name: '预算模板.xlsx', size: 28672, path: 'C:\\Users\\Public\\Documents\\预算模板.xlsx' }],
    updatedAt: days(1)
  },
  {
    id: 'draft-gmail-1',
    accountId: 'acc-gmail',
    kind: 'new',
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    html: '<p>酒店确认号：</p><div class="dymail-signature">Lin Chen</div>',
    inReplyTo: '',
    references: '',
    attachments: [],
    updatedAt: days(2)
  }
];

const demoContacts = [
  { name: '王婷', email: 'wangting@northwind.cn' },
  { name: '李昂', email: 'liang@northwind.cn' },
  { name: '周谨', email: 'zhoujin@northwind.cn' },
  { name: '陈老师', email: 'chen@university.edu.cn' }
];

const demoOpened = [];
const demoNotifications = [];
const demoAccountSaves = [];
const demoDeeplKeys = [];
const demoMoves = [];
const demoDeletes = [];
const demoRestores = [];
const demoPurges = [];
window.dymailDemoCalls = {
  opened: demoOpened,
  notifications: demoNotifications,
  accountSaves: demoAccountSaves,
  contacts: demoContacts,
  deeplKeys: demoDeeplKeys,
  moves: demoMoves,
  deletes: demoDeletes,
  restores: demoRestores,
  purges: demoPurges
};

const settings = {
  theme: 'system',
  refreshSeconds: 60,
  signature: '林辰\n产品设计 · 北风科技',
  remoteImages: 'allow',
  notifyNewMail: true,
  closeToTray: true,
  updateCheck: true,
  updateRepo: 'Aura1n/dymail',
  updateSkipped: '',
  updateLastCheck: 0,
  trashPurgeDays: 30,
  trashPurgeAt: 0,
  hasDeeplKey: false
};

function findAccount(accountId) {
  return accounts.find((account) => account.id === accountId) || null;
}

function roleForPath(path) {
  for (const [role, value] of Object.entries(FOLDER_PATHS)) {
    if (value === path) return role;
  }
  return null;
}

function folderMessages(accountId, path) {
  const box = boxes[accountId];
  const role = roleForPath(path);
  if (!box || !role) return null;
  return box[role] || [];
}

function summary(account, path, item) {
  return {
    accountId: account.id,
    accountEmail: account.email,
    accountName: account.name || '',
    accountColor: account.color,
    path,
    uid: item.uid,
    seq: item.uid,
    subject: item.subject,
    from: item.from,
    date: item.date,
    timestamp: Date.parse(item.date) || 0,
    seen: Boolean(item.seen),
    flagged: Boolean(item.flagged),
    answered: false
  };
}

function folderView(accountId, role) {
  const list = (boxes[accountId] && boxes[accountId][role]) || [];
  return {
    role,
    path: FOLDER_PATHS[role],
    name: FOLDER_NAMES[role],
    delimiter: '/',
    unseen: list.filter((item) => !item.seen).length,
    total: list.length
  };
}

function accountView(account) {
  const folders = ['inbox', 'sent', 'junk', 'trash', 'archive', 'drafts'].map((role) =>
    folderView(account.id, role)
  );
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    color: account.color,
    imap: account.imap,
    smtp: account.smtp,
    hasPassword: true,
    createdAt: account.createdAt,
    folders,
    draftCount: drafts.filter((draft) => draft.accountId === account.id).length,
    error: null
  };
}

function sortMessages(list) {
  return list.slice().sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

function parseAddressList(value) {
  return String(value || '')
    .split(/[,;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^(.*?)\s*<([^>]+)>$/);
      if (match) {
        return { name: match[1].replace(/^"|"$/g, '').trim(), address: match[2].trim() };
      }
      return { name: '', address: part };
    })
    .filter((item) => item.address);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createDemoApi() {
  return {
    app: {
      info: async () => ({ version: '1.3.0', platform: 'win32', packaged: false }),
      open: async (url) => {
        demoOpened.push(String(url || ''));
        return true;
      },
      notify: async (payload) => {
        demoNotifications.push(payload);
        return true;
      }
    },

    accounts: {
      list: async () => accounts.map(accountView),
      save: async (payload) => {
        await wait(320);
        demoAccountSaves.push({ email: payload.email, password: payload.password });
        const existing = payload.id ? findAccount(payload.id) : null;
        if (existing) {
          existing.email = String(payload.email || existing.email);
          existing.name = String(payload.name || '');
          existing.imap = payload.imap || existing.imap;
          existing.smtp = payload.smtp || existing.smtp;
          return accountView(existing);
        }
        const colors = ['#8e5cf7', '#00a3a3', '#e5484d', '#d6409f'];
        const account = {
          id: makeId('acc'),
          email: String(payload.email || ''),
          name: String(payload.name || ''),
          color: colors[accounts.length % colors.length],
          imap: payload.imap,
          smtp: payload.smtp,
          createdAt: new Date().toISOString()
        };
        accounts.push(account);
        boxes[account.id] = { inbox: [], sent: [], junk: [], trash: [], archive: [] };
        return accountView(account);
      },
      remove: async (id) => {
        await wait(120);
        const index = accounts.findIndex((account) => account.id === id);
        if (index < 0) return false;
        accounts.splice(index, 1);
        delete boxes[id];
        for (let i = drafts.length - 1; i >= 0; i -= 1) {
          if (drafts[i].accountId === id) drafts.splice(i, 1);
        }
        return true;
      }
    },

    folders: {
      sync: async () => {
        await wait(160);
        return accounts.map(accountView);
      }
    },

    mail: {
      list: async ({ accountId, path, cursor, limit }) => {
        const account = findAccount(accountId);
        if (!account) throw new Error('账户不存在');
        const list = folderMessages(accountId, path);
        if (!list) throw new Error('文件夹不存在');
        const ordered = sortMessages(list);
        const offset = Math.max(0, Number(cursor) || 0);
        const size = Math.max(1, Number(limit) || 40);
        const slice = ordered.slice(offset, offset + size);
        return {
          messages: slice.map((item) => summary(account, path, item)),
          cursor: offset + slice.length < ordered.length ? offset + slice.length : null,
          total: ordered.length
        };
      },

      listUnified: async ({ cursors, limit }) => {
        await wait(120);
        const size = Math.max(1, Number(limit) || 40);
        const merged = [];
        const next = {};
        for (const account of accounts) {
          const list = sortMessages((boxes[account.id] && boxes[account.id].inbox) || []);
          const offset = Math.max(0, Number(cursors && cursors[account.id]) || 0);
          const slice = list.slice(offset, offset + size);
          for (const item of slice) {
            merged.push(summary(account, FOLDER_PATHS.inbox, item));
          }
          next[account.id] = offset + slice.length < list.length ? offset + slice.length : null;
        }
        merged.sort((a, b) => b.timestamp - a.timestamp || b.uid - a.uid);
        return { messages: merged, cursors: next, errors: [] };
      },

      listStarred: async ({ cursors, limit }) => {
        await wait(120);
        const size = Math.max(1, Number(limit) || 40);
        const merged = [];
        const next = {};
        for (const account of accounts) {
          const list = sortMessages(
            ((boxes[account.id] && boxes[account.id].inbox) || []).filter((item) => item.flagged)
          );
          const offset = Math.max(0, Number(cursors && cursors[account.id]) || 0);
          const slice = list.slice(offset, offset + size);
          for (const item of slice) {
            merged.push(summary(account, FOLDER_PATHS.inbox, item));
          }
          next[account.id] = offset + slice.length < list.length ? offset + slice.length : null;
        }
        merged.sort((a, b) => b.timestamp - a.timestamp || b.uid - a.uid);
        return { messages: merged, cursors: next, errors: [] };
      },

      listArchived: async ({ cursors, limit }) => {
        await wait(120);
        const size = Math.max(1, Number(limit) || 40);
        const merged = [];
        const next = {};
        for (const account of accounts) {
          const list = sortMessages((boxes[account.id] && boxes[account.id].archive) || []);
          const offset = Math.max(0, Number(cursors && cursors[account.id]) || 0);
          const slice = list.slice(offset, offset + size);
          for (const item of slice) {
            merged.push(summary(account, FOLDER_PATHS.archive, item));
          }
          next[account.id] = offset + slice.length < list.length ? offset + slice.length : null;
        }
        merged.sort((a, b) => b.timestamp - a.timestamp || b.uid - a.uid);
        return { messages: merged, cursors: next, errors: [] };
      },

      search: async ({ accountId, path, query }) => {
        await wait(180);
        const needle = String(query || '').toLowerCase();
        const result = [];
        for (const account of accounts) {
          if (accountId && account.id !== accountId) continue;
          const box = boxes[account.id] || {};
          for (const [role, list] of Object.entries(box)) {
            const folderPath = FOLDER_PATHS[role];
            if (path && folderPath !== path) continue;
            for (const item of list) {
              const haystack = [
                item.subject,
                item.text,
                item.html,
                item.from && item.from.name,
                item.from && item.from.address
              ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
              if (haystack.includes(needle)) {
                result.push(summary(account, folderPath, item));
              }
            }
          }
        }
        result.sort((a, b) => b.timestamp - a.timestamp);
        return { messages: result.slice(0, 60), errors: [] };
      },

      read: async ({ accountId, path, uid }) => {
        await wait(140);
        const account = findAccount(accountId);
        if (!account) throw new Error('账户不存在');
        const list = folderMessages(accountId, path);
        if (!list) throw new Error('文件夹不存在');
        const item = list.find((entry) => entry.uid === Number(uid));
        if (!item) throw new Error('邮件不存在');
        item.seen = true;
        return {
          accountId: account.id,
          accountEmail: account.email,
          accountColor: account.color,
          path,
          uid: item.uid,
          subject: item.subject,
          from: item.from,
          to: item.to || [],
          cc: item.cc || [],
          bcc: item.bcc || [],
          date: item.date,
          messageId: `<${item.uid}@demo.dymail>`,
          inReplyTo: '',
          references: '',
          html: item.html || '',
          text: item.text || '',
          hasRemoteImages: /https?:\/\//i.test(item.html || ''),
          attachments: (item.attachments || []).map((attachment, index) => ({
            index,
            name: attachment.name,
            size: attachment.size,
            contentType: attachment.contentType || 'application/octet-stream'
          })),
          seen: true,
          flagged: Boolean(item.flagged)
        };
      },

      document: async (documentText) => {
        if (window.dymail && window.dymail.mail && typeof window.dymail.mail.document === 'function') {
          return window.dymail.mail.document(documentText);
        }
        return URL.createObjectURL(new Blob([documentText || ''], { type: 'text/html;charset=utf-8' }));
      },

      setFlags: async ({ accountId, path, uids, add, remove }) => {
        const list = folderMessages(accountId, path);
        if (!list) throw new Error('文件夹不存在');
        const targets = new Set((uids || []).map(Number));
        const additions = new Set((add || []).map((flag) => String(flag).toLowerCase()));
        const removals = new Set((remove || []).map((flag) => String(flag).toLowerCase()));
        for (const item of list) {
          if (!targets.has(item.uid)) continue;
          if (additions.has('\\seen')) item.seen = true;
          if (removals.has('\\seen')) item.seen = false;
          if (additions.has('\\flagged')) item.flagged = true;
          if (removals.has('\\flagged')) item.flagged = false;
        }
        return true;
      },

      markAllRead: async ({ accountId, path }) => {
        const list = folderMessages(accountId, path);
        if (!list) throw new Error('文件夹不存在');
        for (const item of list) item.seen = true;
        return true;
      },

      move: async ({ accountId, path, uid, uids, target }) => {
        await wait(180);
        const source = folderMessages(accountId, path);
        const targetPath = FOLDER_PATHS[target];
        const destination = targetPath ? folderMessages(accountId, targetPath) : null;
        if (!source || !destination) throw new Error('文件夹不存在');
        /* Mirrors the real client: a whole uid set moves with one command. */
        const wanted = new Set((uids && uids.length ? uids : [uid]).map(Number));
        const moving = source.filter((item) => wanted.has(Number(item.uid)));
        if (!moving.length) throw new Error('邮件不存在');
        demoMoves.push({ target, count: moving.length });
        for (let i = source.length - 1; i >= 0; i -= 1) {
          if (wanted.has(Number(source[i].uid))) destination.push(source.splice(i, 1)[0]);
        }
        return true;
      },

      deletePermanent: async ({ accountId, path, uid, uids }) => {
        await wait(160);
        const list = folderMessages(accountId, path);
        if (!list) throw new Error('文件夹不存在');
        const wanted = new Set((uids && uids.length ? uids : [uid]).map(Number));
        const removed = list.filter((item) => wanted.has(Number(item.uid)));
        if (!removed.length) throw new Error('邮件不存在');
        demoDeletes.push(removed.length);
        for (let i = list.length - 1; i >= 0; i -= 1) {
          if (wanted.has(Number(list[i].uid))) list.splice(i, 1);
        }
        return true;
      },

      /* 还原 = MOVE back to INBOX; the real server can carry the \Deleted flag
         along, which the mail service clears on the destination uid set. */
      restore: async ({ accountId, path, uid, uids }) => {
        await wait(180);
        const source = folderMessages(accountId, path);
        const destination = folderMessages(accountId, FOLDER_PATHS.inbox);
        if (!source || !destination) throw new Error('文件夹不存在');
        const wanted = new Set((uids && uids.length ? uids : [uid]).map(Number));
        const moving = source.filter((item) => wanted.has(Number(item.uid)));
        if (!moving.length) throw new Error('邮件不存在');
        demoRestores.push({ count: moving.length, target: FOLDER_PATHS.inbox });
        for (let i = source.length - 1; i >= 0; i -= 1) {
          if (wanted.has(Number(source[i].uid))) {
            const [item] = source.splice(i, 1);
            item.seen = true;
            destination.unshift(item);
          }
        }
        return { path: FOLDER_PATHS.inbox };
      },

      /* Mirrors the main-process guard: one sweep per ~day, and only when the
         setting is a real day count. */
      purgeTrash: async () => {
        const limit = Number(settings.trashPurgeDays);
        if (!Number.isInteger(limit) || limit < 1) {
          return { days: 0, total: 0, results: [], skipped: true };
        }
        if (Date.now() - (Number(settings.trashPurgeAt) || 0) < 20 * 60 * 60 * 1000) {
          return { days: limit, total: 0, results: [], skipped: true };
        }
        await wait(240);
        settings.trashPurgeAt = Date.now();
        const cutoff = Date.now() - limit * 86400000;
        const results = [];
        for (const account of accounts) {
          const list = (boxes[account.id] && boxes[account.id].trash) || [];
          let removed = 0;
          for (let i = list.length - 1; i >= 0; i -= 1) {
            const at = Date.parse(list[i].date) || 0;
            if (at && at < cutoff) {
              list.splice(i, 1);
              removed += 1;
            }
          }
          results.push({ accountId: account.id, email: account.email, removed });
        }
        const total = results.reduce((sum, item) => sum + item.removed, 0);
        demoPurges.push({ days: limit, total });
        return { days: limit, total, results };
      },

      saveAttachment: async () => {
        await wait(220);
        return { canceled: true };
      }
    },
    compose: {
      send: async (payload) => {
        await wait(520);
        const account = findAccount(payload.accountId);
        if (!account) throw new Error('账户不存在');
        const to = parseAddressList(payload.to);
        if (!to.length) throw new Error('请填写收件人');
        const sent = boxes[account.id].sent;
        sent.push(
          message({
            subject: String(payload.subject || ''),
            from: { name: account.name || '', address: account.email },
            to,
            cc: parseAddressList(payload.cc),
            bcc: parseAddressList(payload.bcc),
            date: new Date().toISOString(),
            seen: true,
            html: String(payload.html || ''),
            text: String(payload.text || '')
          })
        );
        return { messageId: `<${uidSeed}@demo.dymail>`, savedToSent: true, warning: null };
      }
    },

    drafts: {
      list: async (accountId) => {
        await wait(80);
        return drafts
          .filter((draft) => !accountId || draft.accountId === accountId)
          .slice()
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .map((draft) => ({
            id: draft.id,
            accountId: draft.accountId,
            subject: draft.subject,
            updatedAt: draft.updatedAt,
            attachmentCount: draft.attachments.length
          }));
      },

      get: async (id) => {
        const draft = drafts.find((item) => item.id === id);
        return draft ? { ...draft, attachments: draft.attachments.slice() } : null;
      },

      save: async (payload) => {
        await wait(90);
        const existing = payload.id ? drafts.find((item) => item.id === payload.id) : null;
        if (existing) {
          Object.assign(existing, {
            accountId: payload.accountId,
            kind: payload.kind,
            to: String(payload.to || ''),
            cc: String(payload.cc || ''),
            bcc: String(payload.bcc || ''),
            subject: String(payload.subject || ''),
            html: String(payload.html || ''),
            inReplyTo: String(payload.inReplyTo || ''),
            references: String(payload.references || ''),
            attachments: Array.isArray(payload.attachments) ? payload.attachments.slice() : [],
            updatedAt: new Date().toISOString()
          });
          return { id: existing.id, accountId: existing.accountId, updatedAt: existing.updatedAt };
        }
        const draft = {
          id: makeId('draft'),
          accountId: payload.accountId,
          kind: payload.kind || 'new',
          to: String(payload.to || ''),
          cc: String(payload.cc || ''),
          bcc: String(payload.bcc || ''),
          subject: String(payload.subject || ''),
          html: String(payload.html || ''),
          inReplyTo: String(payload.inReplyTo || ''),
          references: String(payload.references || ''),
          attachments: Array.isArray(payload.attachments) ? payload.attachments.slice() : [],
          updatedAt: new Date().toISOString()
        };
        drafts.push(draft);
        return { id: draft.id, accountId: draft.accountId, updatedAt: draft.updatedAt };
      },

      remove: async (id) => {
        await wait(60);
        const index = drafts.findIndex((item) => item.id === id);
        if (index >= 0) drafts.splice(index, 1);
        return true;
      }
    },

    contacts: {
      list: async () => {
        await wait(60);
        return demoContacts
          .slice()
          .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, 'zh-Hans-CN'));
      },

      save: async ({ name, email, originalEmail }) => {
        await wait(80);
        const address = String(email || '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw new Error('联系人邮箱格式不正确');
        const record = { name: String(name || '').trim() || address, email: address };
        const original = String(originalEmail || '').toLowerCase();
        let index = original ? demoContacts.findIndex((item) => item.email.toLowerCase() === original) : -1;
        if (index < 0 && demoContacts.some((item) => item.email.toLowerCase() === address.toLowerCase())) {
          throw new Error('该联系人已存在');
        }
        if (index >= 0) demoContacts[index] = record;
        else demoContacts.push(record);
        return record;
      },

      remove: async ({ email }) => {
        await wait(60);
        const target = String(email || '').toLowerCase();
        const index = demoContacts.findIndex((item) => item.email.toLowerCase() === target);
        if (index >= 0) demoContacts.splice(index, 1);
        return true;
      }
    },

    files: {
      pick: async () => [
        { path: 'C:\\Users\\Public\\Documents\\预算模板.xlsx', name: '预算模板.xlsx', size: 28672 }
      ]
    },

    settings: {
      get: async () => ({ ...settings }),
      update: async (payload) => {
        if (payload && typeof payload === 'object') {
          if (['system', 'light', 'dark'].includes(payload.theme)) settings.theme = payload.theme;
          if (payload.refreshSeconds != null) {
            settings.refreshSeconds = Math.max(0, Number(payload.refreshSeconds) || 0);
          }
          if (typeof payload.signature === 'string') settings.signature = payload.signature.slice(0, 2000);
          if (['allow', 'block'].includes(payload.remoteImages)) settings.remoteImages = payload.remoteImages;
          for (const flag of ['notifyNewMail', 'closeToTray', 'updateCheck']) {
            if (typeof payload[flag] === 'boolean') settings[flag] = payload[flag];
          }
          if (typeof payload.updateRepo === 'string') {
            const repo = payload.updateRepo.trim();
            if (repo && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('仓库格式应为 owner/repo');
            settings.updateRepo = repo;
          }
          if (typeof payload.updateSkipped === 'string') settings.updateSkipped = payload.updateSkipped.trim();
          if (Number.isFinite(Number(payload.updateLastCheck))) settings.updateLastCheck = Number(payload.updateLastCheck);
          if ([0, 15, 30, 60, 90].includes(Number(payload.trashPurgeDays))) {
            settings.trashPurgeDays = Number(payload.trashPurgeDays);
          }
        }
        return { ...settings };
      },
      /* Mirrors the real store: the key is a credential, so only its presence is reported back. */
      setDeeplKey: async (key) => {
        const value = String(key == null ? '' : key).trim();
        demoDeeplKeys.push(value);
        settings.hasDeeplKey = Boolean(value);
        return { ...settings };
      }
    },

    translate: {
      segments: async (segments) => {
        if (window.dymail && window.dymail.translate && typeof window.dymail.translate.segments === 'function') {
          return window.dymail.translate.segments(segments);
        }
        return { translated: (segments || []).map(() => ''), provider: 'none', notice: '演示环境没有连接翻译服务' };
      }
    },

    update: {
      check: async () => {
        await wait(400);
        if (!settings.updateRepo) throw new Error('未配置更新源，请填写 owner/repo');
        return {
          current: '1.3.0',
          latest: '1.3.1',
          hasUpdate: true,
          notes: '· 已删除邮件可还原到收件箱，超过设定天数的自动彻底删除\n· 批量操作合并为单条 IMAP 命令，账户没有归档文件夹时自动创建\n· 阅读页可一键把英文正文翻译成中文',
          url: `https://github.com/${settings.updateRepo}/releases/latest`,
          page: `https://github.com/${settings.updateRepo}/releases`,
          checkedAt: Date.now()
        };
      }
    },

    dialog: {
      confirm: async () => true
    },

    window: {
      setChrome: async () => false
    }
  };
}
