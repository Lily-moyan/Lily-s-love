# Git 推送说明（本机）

这个工作区是 `git@github.com:Lily-moyan/Lily-s-love.git` 的本地副本。
下面是**本机特有的推送方式**，换机器或忘记时看这一份。

---

## 一、为什么需要额外设置

本机的 `C:\Users\LL\.ssh` 里**没有私钥**（只有 known_hosts），
推送用的是工作区内的**部署密钥**，通过一个包装脚本指定：

| 文件 | 作用 |
|---|---|
| `.deploy/id_ed25519` | 部署私钥（**已被 .gitignore 排除，绝不入库**） |
| `.deploy/home/.ssh/config` | 指定 `IdentityFile` 与 `UserKnownHostsFile` |
| `.deploy/ssh.cmd` | 调用系统 `ssh.exe` 并加载上面的 config |

> `.deploy/` 整个目录不入库。换电脑推送需要重新配置密钥。

---

## 二、推送步骤

```powershell
# 1. 指向部署密钥的 ssh 包装脚本（每次新开终端都要设）
$env:GIT_SSH = 'G:\dsh\.deploy\ssh.cmd'

# 2. 确认能连上（应打印远端 main 的 commit）
git ls-remote --heads origin

# 3. 提交并推送
git add -A
git commit -m "说明这次改了什么"
git push origin main
```

### 验证确实推上去了

```powershell
git rev-parse HEAD          # 本地 HEAD
git rev-parse origin/main   # 远端 HEAD，两者应相同
git status -sb              # 首行不应再出现 ahead
```

---

## 三、两个容易踩的坑

### 1. 中文路径不能用命令行参数传给 git
PowerShell 5.1 会把中文参数按 ANSI 转换，导致
`fatal: pathspec '背单词APP' did not match any files`。

解决办法：**用无 BOM 的 UTF-8 路径文件**。

```powershell
[System.IO.File]::WriteAllText('G:\dsh\.tmp\paths.txt', "背单词APP`n",
  (New-Object System.Text.UTF8Encoding($false)))
git add --pathspec-from-file="G:\dsh\.tmp\paths.txt"
```

注意 `Set-Content -Encoding UTF8` 写出来的是 **带 BOM** 的，git 会把 BOM 当成路径的一部分
（报 `pathspec '﻿背单词APP' did not match`），所以要用上面的 `UTF8Encoding($false)`。

### 2. 提交信息不要用 PowerShell here-string
`git commit -F - <<< $msg` 在 PowerShell 里不支持（`<` 保留）。写成文件再 `-F`：

```powershell
git commit -F "G:\dsh\.tmp\commit-msg.txt"
```

---

## 四、哪些内容不入库（.gitignore）

| 类别 | 例子 |
|---|---|
| 依赖与缓存 | `node_modules/`、`.pnpm-store/`、`.npm-cache/`、`.npm-libs/`、`.pip-cache/`、`.uv-cache/`、`.tts-libs/` |
| 构建产物 | `.next/`、`dist/`、`build/`、`out/`、`__pycache__/` |
| **密钥与证书** | `.deploy/`、`背单词APP/.certs/`、`*.pem`、`*.key`、`wechat-config.json` |
| 临时与运行态 | `.tmp/`、`.tmp-mask/`、`.render_work/`、`.dsh/`、`~$*` |

**推之前务必确认**这几类没有被加进去：

```powershell
git ls-tree -r HEAD | Select-String 'node_modules|\.certs|id_ed25519|\.pem$|\.env$|wechat-config\.json'
```

---

## 五、两个已知问题

1. **`重回高一，我先卷为敬/` 是嵌套的 git 仓库**，在父仓库里只记录成一个指针，
   远端是灰色文件夹、**内容不会随 clone 下来**。工作目录日常编辑不受影响。
   要让内容真正入库，需要先删掉它内部的 `.git` 再重新 `git add`。

2. **提交者邮箱是占位值**（`your-email@email.com`）。想让提交记录归属到 GitHub 账号，
   改一下：
   ```powershell
   git config --global user.email "你的邮箱"
   ```

---

## 六、历史记录

| commit | 内容 |
|---|---|
| `13190ce` | Initial commit：行业分析工作台 |
| `ecc93d9` | 新增背单词 PWA「每天一个小故事」（6 岁强度） |
| `c268626` | 同步工作区其余项目（存档） |
