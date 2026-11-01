# Dymail

Windows 桌面邮件客户端，把多个邮箱聚合在同一界面里统一管理。

## 功能

- 多账户：Gmail、Outlook/Hotmail、QQ、163/126、阿里、新浪、企业邮箱与自定义 IMAP/SMTP
- 三栏固定布局（侧栏 / 列表 / 正文），非内容区域不需要滚动
- 亮色、暗色、跟随系统；暗色下正文按邮件原有配色整体反相，保留作者定义的对比度
- 邮件正文在沙箱 iframe 中渲染，先经 DOM 清洗（脚本、表单、事件属性、危险 URL 全部移除），远程图片可按需在设置里放行或阻止
- 新邮件桌面通知，关闭窗口默认最小化到托盘继续收信
- 检查更新走 GitHub Releases，发现新版可下载或忽略该版本
- 账户密码通过 Electron safeStorage（Windows 数据保护 API）加密保存；系统加密不可用时直接拒绝保存，不会写明文

## 开发

```bash
npm install
npm start            # 正常运行
npm run dev          # 开发模式
DYMALL_DEMO=1 npm start   # 演示数据模式，不连接真实邮箱
```

## 打包

```bash
npm run icons        # 重新生成 assets/icon.ico、icon.png、tray.png
npm run dist         # 产出便携版与 NSIS 安装版到 dist/
```

## 数据位置

配置与本地草稿在 `%APPDATA%\Dymail\dymail.json`，卸载程序不会删除它。
