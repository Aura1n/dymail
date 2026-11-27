# Dymail Mobile（Android）

桌面端 Dymail 的手机版。**桌面端代码（`src/`）一行没改**：邮件核心原样复用，只新增了本目录。

打包到手机、开启后台收信：看 **[BUILD-ANDROID.md](BUILD-ANDROID.md)**。

```
mobile/
├── www/                 手机界面（原生 JS，无需构建）
│   ├── app.js           首页：列表、会话分组、左右滑动、抽屉、搜索、多选、下拉刷新
│   ├── reader.js        阅读 / 会话页：翻译、屏蔽发件人、回复转发、附件保存
│   ├── compose.js       写信：附件、定时发送、联系人联想、草稿
│   ├── settings.js      设置、添加账户、检查更新、DeepL 密钥
│   ├── background.js · background-ui.js   后台收信：与 Android 插件的接口、设置页里的开关
│   ├── rules.js · contacts.js · translate.js · update.js · ui.js · state.js · icons.js · providers.js
│   ├── native.js        手机版的 preload：通过本地桥调用核心（接口与桌面一致），并执行核心发来的“打开链接/复制”
│   ├── bridge.js        选择数据源：Android 内置核心 / ?core= 的电脑核心 / 演示数据
│   └── shared/          与桌面共用的 demo.js、sanitize.js（scripts/sync-shared.js 同步）
├── glue/glue.js         打包时生成 dist/glue.js：把 Capacitor 插件交给页面（页面本身没有打包器）
├── core/
│   ├── electron-shim.js 让桌面主进程在纯 Node 里跑起来的 electron 替身
│   ├── index.js         无头核心：加载 src/main/main.js，把 IPC 暴露在 127.0.0.1 的 HTTP/SSE 上；
│   │                    另加手机专用通道 mobile:stage-file、mobile:update-check、mobile:poll
│   ├── notifier.js      “哪些是新邮件、通知写什么”：后台通知的判断逻辑
│   └── update.js        Android 更新检测
├── nodejs/entry.js      Android 内 Node 进程的入口：确定数据目录和密钥，启动核心，把本地地址告诉页面
├── native/              Android 原生代码模板（补丁脚本填入包名后复制进工程）
│   ├── DymailBackgroundPlugin.java.tpl   页面控制后台服务、权限和系统设置的插件
│   ├── MailSyncService.java.tpl          前台服务：读核心的事件流弹通知，定时唤醒做兜底检查
│   ├── MainActivity.java.tpl             注册插件
│   └── DymailBuild.gradle.tpl            发布构建设置（只打 arm64、签名密钥），补丁复制成 app/dymail.gradle
├── scripts/             build-www · patch-android · build-apk · test-bundle · verify · dev · smoke ·
│                        test-update · test-notifier · test-patch-android · sync-shared
├── version.json         手机版自己的版本号（与桌面 1.4.x 分开）；APK 的 versionName/versionCode 由它生成
├── release/             构建产物（Dymail-Android-<版本>.apk，不进 git）
├── capacitor.config.json · package.json · .gitignore
└── BUILD-ANDROID.md     打包步骤、后台收信的用法与已知限制
```

## 架构

```
 WebView（dist/）  ──fetch /rpc──▶  127.0.0.1:随机端口  ──▶  core/index.js（打成一个文件 dist/nodejs/index.js）
        ▲  ▲                                                └─ electron-shim ─▶ src/main/main.js（桌面主进程，未改）
        │  └── capacitor-nodejs 的消息通道：页面问 get-core，核心答 core-ready {port, token}
        └──── EventSource /events（新邮件推送、状态、“打开链接”命令）
                                  ▲
 前台服务 MailSyncService ────────┘  同一个事件流（不经过 WebView）；收到 notify 命令就弹系统通知
```

- 界面只认 `dymail.*` 这一套接口（与 `src/preload/preload.js` 相同），桌面的 IMAP/SMTP、过滤规则、定时发送、已删除还原、翻译全部直接可用。
- 桥只监听回环地址，每次请求必须带随机令牌；页面来源只允许 Capacitor 的 `http://localhost`。
- 打包用 esbuild 把核心、桌面主进程和 `imapflow` / `mailparser` / `nodemailer` 合成一个文件（构建时把 `electron` 指到替身），不带 `node_modules`——Android 打包会丢掉名字以 `_` 开头的目录，一个文件也启动得更快。
- 页面不知道核心是已经在跑（页面重载）还是正在启动（冷启动），所以每 0.7 秒问一次，最长等 45 秒。
- 凭据加密：AES-256-GCM。**当前密钥存在应用私有目录**（不在 Keystore）；设置环境变量 `DYMAIL_MASTER_KEY` 可以覆盖，这是以后接 Keystore 的入口。没有密钥时核心拒绝保存密码。
- 附件：WebView 只有文件内容、没有路径，所以先通过 `mobile:stage-file` 存到应用私有目录（24 小时后清理），再把路径交给邮件层。

## 后台收信

桌面端靠页面里的逻辑弹通知（比较未读数），手机上页面一退到后台就被冻结，所以判断放在核心里（`core/notifier.js`），服务只负责显示。

- 触发：IMAP 推送、连接恢复、启动后 8 秒、服务每 5～30 分钟一次的兜底检查（用闹钟唤醒，只短暂持有唤醒锁）。
- “新”：编号大于已记录的最大编号且未读；第一次见到的邮箱只记基准，不通知。命中规则（已读/归档/删除）或黑名单的不通知。
- 应用在前台时不弹通知；点通知只打开应用。
- 服务被系统结束后不会自己恢复（Node 核心只能由应用启动），会尽量弹一条「后台收信已中断」。
- 设置页「后台收信」：总开关、通知权限、电池优化、兜底检查间隔、是否显示新邮件通知、跳转应用设置。

## 更新检测

桌面端启动后静默检查一次，之后每 6 小时检查一次，只认 Windows `.exe` 并自行下载安装；手机端不能复用，单独实现：

- 启动 4 秒后检查，之后距上次成功检查满 6 小时才再查，回到前台也会补查。设置项与桌面一致：自动检查开关、更新源（`owner/repo`）、跳过版本。
- 在最近 20 个正式发布里找带 `.apk` 的最新版本，与已安装版本比较；忽略草稿和预发布；下载链接只接受更新源仓库下的地址。
- 发现新版本时弹出面板：下载（交给系统浏览器，Android 确认安装）、跳过此版本、稍后。你正在写信或打开了其他页面时会暂缓弹出。
- Android 不允许应用静默安装，所以这里只做**检测和引导**。

发布约定：在同一个仓库发布带 `.apk` 的 Release，标签用 `android-v<版本>`（如 `android-v0.1.0`），**并勾选「预发布」**。原因：GitHub 的 `releases/latest` 取发布时间最新的正式发布，装了 1.4.x 的桌面端会去读它；没有 exe 的 Android 发布一旦成为最新，那些老版本桌面端的「检查更新」就会失败。桌面端的更新逻辑已经改成“在最近的发布里找最新的、带 exe 的那个”，手机端则单独认 `android-*` 的预发布。每次发版改 `mobile/version.json`，APK 的 `versionName`/`versionCode` 由 `npm run apk` 自动同步。

## 在电脑上跑

需要 Node 18+，在项目根目录执行：

```bash
node mobile/scripts/verify.js         # 语法、导入、更新检测、新邮件判断、Android 补丁、核心自检；结果存到 mobile/tmp/verify-report.txt
node mobile/scripts/dev.js            # 演示数据预览：http://localhost:5173/?demo=1
node mobile/scripts/dev.js --core     # 连真实核心，终端会打印带令牌的网址
cd mobile && npm run test:bundle      # 打包并在电脑上试跑手机用的核心（需先在根目录 npm install）
cd mobile && npm run apk              # 打包 + 补丁 + 签名，产出 release/Dymail-Android-<版本>.apk
```

依赖只在**根目录** `npm install` 一次。`mobile/package.json` 必须声明 `@capacitor/core`、`@capacitor/android`、`@capacitor/browser`、`capacitor-nodejs`：Capacitor 按这份清单找插件，少一个就不会把它接进 Android 工程（打出来的包没有 Node 运行时）。

预览要用 Chrome 的触摸模拟（F12，再按 Ctrl+Shift+M），否则滑动手势没有反应。预览里没有「后台收信」一栏，它只在 Android 应用里出现。

## 已实现 / 暂未实现

**已实现**

- 全部收件箱、星标、归档、各账户文件夹、草稿；定时发送列表（立即发送 / 编辑 / 取消）
- 会话视图、仅看未读、左右滑动、长按多选、下拉刷新、滚动加载、搜索
- 阅读：沙箱 iframe、远程图片开关、窄屏缩放、附件保存、一键翻译成中文、屏蔽发件人
- 回复 / 全部回复 / 转发、写信添加附件、定时发送、联系人联想、草稿自动保存
- 过滤规则、黑名单、联系人、DeepL 密钥、深浅色主题、签名、多账户
- 自动检测更新、Android 返回键逐层关闭
- **后台收信与新邮件通知**（前台服务 + 兜底检查），定时发送结果通知
- Capacitor 外壳的构建脚本（打包、补丁、测试）

**暂未实现**

- Gmail / Outlook 网页授权登录默认关闭：构建时注入 OAuth Client ID 后才显示登录按钮（见 BUILD-ANDROID.md）；未注入时页面引导用应用专用密码，Outlook 因微软停用密码登录暂无法添加
- 密钥放进 Android Keystore
- 点通知直接跳到那封邮件、使用应用自己的通知图标
- 进程被结束后自动恢复后台收信（受 Node 运行时限制）
- 附件保存后在文件管理器里可见（分享 / 另存为）
- iOS、平板与横屏布局、写信的富文本和上传进度条
- 应用内下载与静默安装更新（Android 不允许）

## 验证状态

2026-11-27，本机（Windows）实跑结果：

- `node mobile/scripts/verify.js` 全部通过：35 个文件的语法检查、39 条相对导入、更新检测 8 项、新邮件判断 18 项、Android 工程补丁 14 项、核心自检 12 项。
- `npm run test:bundle`：核心打成 3.2 MB 单文件，在假 Node 运行时里启动、应答、建密钥都正常。
- `npm run apk`：Java 编译通过，产出 53 MB 的 `arm64-v8a` 发布包，`versionName 0.1.0`/`versionCode 100`，已用发布密钥签名（`apksigner verify` 通过）。

**没有在真机上跑过**：应用启动与核心拉起、后台收信在熄屏/被清理后的表现、通知、真实邮箱收发与 IMAP IDLE 的稳定性。装到手机后按 `BUILD-ANDROID.md` 第六步逐项试，出问题把 `adb logcat -s DymailSync:V` 的输出发我。
