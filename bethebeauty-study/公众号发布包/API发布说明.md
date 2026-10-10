# API 发布说明 ·《别急着花三万块学「造AI」了》

## 一、为什么不能在这个会话里直接发

两个硬障碍，都已实测：

1. **凭据类型不对。** `gh_e60036ba35d9` 是**公众号原始ID**（公开标识），不是 AppID。调接口要 `wx` 开头的 **AppID** 与 32 位的 **AppSecret**。
2. **这个环境出不了网。** 实测 `Invoke-RestMethod` 连 `api.weixin.qq.com` 直接失败（"基础连接已经关闭"）；而 `WebFetch` 只能发 GET，发不了草稿接口要求的 POST。

→ 所以：**脚本在你自己的电脑上跑**，那条链路是通的。

## 二、跑之前先确认三件事

| # | 检查项 | 在哪看 | 不满足会怎样 |
| --- | --- | --- | --- |
| 1 | 有 **AppID / AppSecret** | 后台「设置与开发 → 基本配置」 | 拿不到 access_token |
| 2 | 本机公网 IP 已进 **IP白名单** | 同一页面的「IP白名单」 | `errcode 40164` |
| 3 | 账号有 **草稿箱接口权限** | 后台「设置与开发 → 接口权限」列表里找「新增草稿」/「发布能力」 | `errcode 48001` |

**关于第 3 条要说清楚**：草稿箱/发布类接口通常要求**已认证**的服务号或订阅号；**个人主体的未认证订阅号**多数情况下拿不到这个权限。如果你是这种号，脚本会明确报 `48001`，这时候只能用复制粘贴方案——`排版稿.html` 就是为这种情况准备的。

> 核对账号：只认后台「设置与开发 → 公众号设置 → 账号详情 → 原始ID」，看是否为 `gh_e60036ba35d9`。
> **不要走"原始ID 换算 `__biz` 生成历史消息页链接"这条捷径**（本说明早先版本给过一条这样的链接，已作废）：
> 一是微信早已限制 `profile_ext` 历史消息页的访问，手机上打不开是常态，与参数对不对无关；
> 二是"gh_id 十六进制转十进制再 base64"的换算没有查证过，不能保证对应到你的号。

## 三、四步跑起来

```powershell
cd G:\dsh\bethebeauty-study\公众号发布包

# 1. 复制配置模板并填写（不要提交到 git）
Copy-Item .\wechat-config.example.json .\wechat-config.json
notepad .\wechat-config.json

# 2. 空跑：不联网、不需要凭据，只验证正文读取
.\发布到草稿箱.ps1 -DryRun

# 3. 检查生成的 dryrun-body.json（应看到完整正文 HTML，约 6.9k 字符）
notepad .\dryrun-body.json

# 4. 正式创建草稿
.\发布到草稿箱.ps1
```

如果提示"禁止运行脚本"，换这种写法：

```powershell
powershell -ExecutionPolicy Bypass -File .\发布到草稿箱.ps1
powershell -ExecutionPolicy Bypass -File .\发布到草稿箱.ps1 -CoverPath .\封面.png
```

**PowerShell 版本**：Windows 自带的 **5.1 就能跑**，不需要装 PowerShell 7（脚本已改为手写 multipart 上传，不再依赖 7 才有的 `-Form`）。脚本第一行会打印当前版本。

## 四、编码坑（务必注意）

**.ps1 文件必须以「UTF-8 带 BOM」保存。**

Windows PowerShell 5.1 在没有 BOM 时，会按系统 ANSI（中文系统是 GBK）解码脚本文件——中文全变乱码，乱码还会吃掉引号，报一堆莫名其妙的语法错误（`Missing ')' in function parameter list` 之类，看起来完全不像编码问题）。

现在这个文件是 UTF-8 带 BOM 的（前三字节 `EF BB BF`）。如果你用编辑器改过它，请确认保存时带上 BOM；或者干脆别改，改 `.md` 就好。

> 顺带一个好消息：正文内容本身不受这个坑影响。PS 5.1 的 `ConvertTo-Json` 会把中文转成 `\uXXXX` 转义，请求体是纯 ASCII，所以草稿正文不会乱码。

## 五、脚本做什么、不做什么

做的事：
1. `cgi-bin/token` 取 access_token（有效期 7200 秒）；
2. 有 `-CoverPath` 时用 `material/add_material?type=image` 传封面拿 `thumb_media_id`；
3. 从 `排版稿.html` 抽出 `<body>` 内的片段，去掉 HTML 注释，调 `draft/add` 建草稿；
4. 中文用 UTF-8 字节发送正文，避免请求体乱码。

不做的事：不群发、不动你已有的素材、不修改任何后台设置。

## 六、报错对照表

| errcode | 含义 | 怎么办 |
| --- | --- | --- |
| 40164 | IP 不在白名单 | 把脚本提示的本机公网 IP 加进「基本配置 → IP白名单」 |
| 40013 / 40125 | AppID / AppSecret 无效 | 核对或重置开发者密码 |
| 48001 | 接口未授权 | 号没有该权限（多为个人未认证订阅号）→ 改用复制粘贴方案 |
| 45009 | 频率超限 | 等几分钟再试，别连续重跑 |
| 40001 / 42001 | token 失效/过期 | 直接重跑脚本 |

## 七、安全提醒

- **AppSecret 不要贴进任何对话。** 放进 `wechat-config.json` 或环境变量 `WECHAT_APPID` / `WECHAT_SECRET`。
- `wechat-config.json` 不要提交到 git；本工作区根目录 `.gitignore` 已加入 `wechat-config.json` 与 `dryrun-body.json`。
- AppSecret 一旦外泄，去后台**重置**，旧值立即失效。
- access_token 等同于该号的临时钥匙，不要打印到公开日志里。
