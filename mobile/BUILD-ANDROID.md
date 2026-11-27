# 打包 Android 版（自用侧载）

目标：构建出可直接安装的 `Dymail-Android-<版本>.apk`，装到手机上用；发版时把它上传到 GitHub Release。
下面每一步都在 Windows 命令提示符（cmd）里执行。

**前提**
- Node 22 以上（Capacitor 8 要求）。
- Android Studio（含 SDK 与 JDK）。本机在 `D:\Programs\Utilities\android`，SDK 在 `C:\Users\zara\AppData\Local\Android\Sdk`，`platforms` / `build-tools` / `platform-tools\adb.exe` 都已安装。
- 不需要单独装 JDK：构建脚本会自动找 `JAVA_HOME`，找不到就用 Android Studio 自带的 `jbr`（JDK 21）。

## 第一步：安装依赖（只做一次）

在**项目根目录**安装一次即可，`mobile/` 不单独装：

```bat
cd D:\Project\dymail
npm install
```

- Capacitor 会按 `mobile/package.json` 里声明的依赖去找插件（实际文件在根目录的 `node_modules`）。**这一步不能省**：`mobile/package.json` 里没有声明插件时，`cap sync` 不会把 `capacitor-nodejs` 接进 Android 工程，打出来的安装包只有几 MB、没有 Node 运行时，页面会停在“启动超时”。
- `capacitor-nodejs` 这个 Node 运行时底层停在已停止维护的 Node 18.20，上游作者建议只做自用侧载，不要当作商店发行方案。
- 如果你的 npm 是 12 版本：它默认拦截依赖的安装脚本，可以运行 `npx cap doctor` 查看被拦截的包，按提示 `npm install-scripts approve <包名>` 后再 `npm rebuild`。

## 第二步：先在电脑上验证（重要）

```bat
cd D:\Project\dymail
node mobile/scripts/verify.js
cd mobile
npm run test:bundle
```

- `verify.js` 不需要 Android Studio：语法检查、导入检查，以及更新检测、**新邮件判断**、**Android 工程补丁**、核心自检四组测试；结果存到 `mobile/tmp/verify-report.txt`。
- `npm run test:bundle` 把手机用的核心打成一个文件，用假的 Node 运行时在电脑上启动并应答。

**这两步不通过，不要往下做。**

## 第三步：生成 Android 工程

工程已经生成在 `mobile/android`，只有删掉重来时才需要：

```bat
cd D:\Project\dymail\mobile
npx cap add android
```

## 第四步：构建安装包

```bat
cd D:\Project\dymail\mobile
npm run apk
```

一条命令做完：重新打包页面与核心 → `cap sync` → 打补丁（本机回环明文、关闭自动备份、后台收信权限与前台服务、插件 Java 源码、版本号）→ `gradlew :app:assembleRelease` → 签名 → 复制到 `mobile\release\Dymail-Android-<版本>.apk`，并打印大小与 sha256。

- 版本号只改 `mobile/version.json`：`versionName` 与 `versionCode`（如 `0.1.0` → 100）由补丁脚本写入 `app/build.gradle`，APK 内的核心也从同一处读版本，更新检测才对得上。
- 只打 `arm64-v8a`：Node 运行时每种架构带一个约 48 MB 的 `libnode.so`，三种架构一起打会把 53 MB 变成 150 MB。
- 签名密钥在 `mobile\keystore\dymail-release.jks`，密码在 `mobile\android\keystore.properties`。两者都不进 git，**务必备份**：丢了就无法给已安装用户发能覆盖安装的更新。
- 想用 Android Studio 手动构建也可以：打开 `mobile/android`，选 **Build → Build Bundle(s) / APK(s) → Build APK(s)**（那里出来的是调试版）。

## 第五步：装到手机

手机打开「开发者选项 → USB 调试」，用数据线连电脑：

```bat
C:\Users\zara\AppData\Local\Android\Sdk\platform-tools\adb.exe devices
C:\Users\zara\AppData\Local\Android\Sdk\platform-tools\adb.exe install -r mobile\release\Dymail-Android-0.1.0.apk
```

也可以把 APK 拷到手机，用文件管理器点开安装（需要允许「安装未知应用」）。调试版与发布版签名不同，换装前要先卸载旧包。

## 第六步：开启后台收信并测试

1. 第一次打开会等几秒（本地邮件服务在启动）。添加账户，**先用 QQ / 163 这类授权码方式**，页面里有各家授权码的官方获取入口；Gmail 用应用专用密码（默认构建未开通网页授权登录）。
2. 进入 **设置 → 后台收信**，打开开关：
   - 先弹出通知权限（Android 13 及以上），选「允许」；
   - 再弹出电池优化对话框，选「允许」，否则熄屏后系统可能暂停联网；
   - 通知栏会出现一条常驻的「后台收信已开启」。
3. 按电源键熄屏，用另一个设备或邮箱给自己发一封信，应在几秒到几分钟内弹出「账户名 · 收件箱」的通知。
4. 再试两种更接近真实使用的情况：
   - 深度休眠：连着数据线，运行 `adb shell dumpsys deviceidle force-idle`，发邮件，等一个兜底检查间隔；测完运行 `adb shell dumpsys deviceidle unforce` 恢复。
   - 被系统结束：在最近任务里划掉应用。如果系统结束了进程，应该看到「后台收信已中断」的通知，点它打开应用即可恢复。

出问题时，用数据线连着看日志：

```bat
adb logcat -s DymailSync:V
adb shell dumpsys deviceidle whitelist | findstr dymail
```

第二条能看到应用是否在电池优化白名单里。也可以在电脑 Chrome 打开 `chrome://inspect` 查看手机里的页面（调试版可用）。

## 启用 Google / Microsoft 授权登录（可选）

授权登录走「系统浏览器 + 本机回环回调」，手机上同样可用，但需要你自己注册 OAuth 客户端（一次性）：

1. Google：Cloud Console → OAuth 同意屏幕（外部；`https://mail.google.com/` 是受限作用域，测试阶段把自己的账号加进测试用户）→ 凭据 → 创建「桌面应用」客户端，拿到 Client ID（和 Secret）。
2. Microsoft：Entra 管理中心 → 应用注册 → 平台选「移动和桌面应用」，重定向 URI 填 `http://localhost`（任意端口）。
3. 构建前在命令行注入，再 `npm run apk`：

```bat
set DYMAIL_GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
set DYMAIL_GOOGLE_CLIENT_SECRET=xxxx
set DYMAIL_MICROSOFT_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
npm run apk
```

构建脚本会把这几个值冻结进核心包；没注入的提供商在添加账户页不显示登录按钮，改为引导应用专用密码。注入后按钮出现，授权在系统浏览器完成（此路径尚未在真机验证）。

## 发版

1. 改 `mobile/version.json`（例如 `0.1.1`），运行 `npm run apk`。
2. 把 `mobile\release\Dymail-Android-<版本>.apk` 上传到 GitHub Release，标签 `android-v<版本>`，**勾选「预发布」**（`gh release create android-v0.1.1 --prerelease ...`）。
   - 勾预发布的原因：桌面端老版本会读 `releases/latest`，一个没有 exe 的正式发布会让它「检查更新」失败。手机端专门认 `android-*` 的预发布。
3. 手机端每 6 小时检查一次，发现带 `.apk` 的 `android-*` 新版本会提示下载（跳到系统浏览器，由 Android 确认安装）。

## 后台收信的工作方式

```
 Node 核心（应用进程内）
   ├─ IMAP IDLE：邮箱有新邮件 → 推送 ──┐
   ├─ 连接恢复 / 启动 / 兜底检查 ───────┤→ 判断“哪些是新的” → 发出 notify 命令
   │                                    │
 前台服务（MailSyncService）            │
   ├─ 常驻线程读取核心的事件流 ◀────────┘→ 弹出系统通知（应用在前台时不弹）
   └─ 每 5～30 分钟用闹钟唤醒一次，让核心把所有邮箱重新检查一遍（兜底）
```

- “新邮件”的定义：该邮箱里编号比已记录的最大编号大、且未读。第一次见到一个邮箱只记录基准，不通知，所以装好后不会把旧邮件全弹出来。基准保存在数据目录的 `notified.json`。
- 已被你的规则标为已读、归档、删除的邮件，以及黑名单发件人，不弹通知。后台检查时会按规则处理最新的 20 封。
- 定时发送的结果（已发送 / 失败）也会弹通知，失败只在第一次提醒。
- 兜底检查是为了对付“网络悄悄断开了连接，但程序不知道”：蜂窝网络上空闲连接常被运营商断开。最坏延迟约等于你设的间隔。
- 前台服务类型用的是 `specialUse`，没有 Android 15 对 `dataSync` 类型的 6 小时限制。

## 这个版本的限制

| 限制 | 说明 |
|---|---|
| 进程被系统结束后不会自己恢复 | Node 核心只能由应用启动。系统结束进程（或手机重启）后，需要打开一次应用才能继续后台收信；被结束时会尽量弹一条「已中断」提示。 |
| 国产系统（小米、华为、OPPO、vivo 等） | 需要在系统设置里允许本应用自启动、后台运行，并在最近任务里锁定它。「设置 → 后台收信 → 应用设置」可直达。否则很可能被清理。 |
| 耗电 | 一条常驻通知，加每 N 分钟一次的短暂唤醒；没有长期持有唤醒锁。间隔越短越及时、越耗电。 |
| 通知点开只打开应用 | 不会直接跳到那封邮件。 |
| 通知图标 | 用的是系统自带图标，不是应用图标。 |
| Gmail / Outlook 网页授权登录默认关闭 | 构建时没有注入 OAuth Client ID（见下方「启用 Google / Microsoft 授权登录」）。未注入时界面不再显示登录按钮，改为引导用应用专用密码；Outlook 因微软停用密码登录而无法添加。 |
| 密钥不在 Android Keystore | 账户密码是加密保存的，但密钥文件放在应用私有目录里，和数据在一起。能挡住其他应用，挡不住 root 或完整备份。 |
| 保存的附件看不到 | 附件保存在应用私有目录，文件管理器里找不到。需要再接入「分享/另存为」。 |
| Node 18、没有 Intl | 联系人排序等少数地方可能和桌面略有差异。 |
| 只有 arm64 | 32 位老机型装不上；如需支持，改 `mobile/native/DymailBuild.gradle.tpl` 里的 `abiFilters`，包会大一倍。 |
| 自签名 | 只能自己侧载，不能上架商店；签名密钥丢失后无法给已安装用户发更新。 |

## 已经验证过 / 还没有验证过

**已经验证过（2026-11-27，本机）**

- `node mobile/scripts/verify.js` 全部通过：语法、导入、更新检测、新邮件判断、Android 补丁、核心自检。
- `npm run test:bundle`：核心打成 3.2 MB 单文件，用假运行时启动并应答正常。
- **Java 代码已编译通过**，并产出可安装的发布版 APK（53 MB，`arm64-v8a`，`versionName 0.1.0`，已用发布密钥签名）。

**没有在真机上验证过**

- 应用在手机上启动、Node 核心起得来、页面连得上本地桥。
- Node 运行时退到后台、熄屏后是否继续运行（插件只说会发 `onPause`，没说引擎是否被暂停）。
- 前台服务被系统结束后的恢复提示、各品牌手机对后台进程的实际处理。
- IMAP IDLE 在你的邮箱和网络下能保持多久、真实收发与通知。
