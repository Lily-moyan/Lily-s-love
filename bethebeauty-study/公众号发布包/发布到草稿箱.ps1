# 一键把本文推进公众号草稿箱（在你自己的电脑上运行）
#
# 兼容性：Windows PowerShell 5.1 与 PowerShell 7 均可。
# 重要：本文件必须以「UTF-8 带 BOM」保存，否则 PS 5.1 会按 GBK 解码中文导致语法报错。
#
# 用法：
#   1. 复制 wechat-config.example.json 为 wechat-config.json，填 appid / secret
#   2. 空跑（不联网、不需要凭据）验证正文读取：  .\发布到草稿箱.ps1 -DryRun
#   3. 正式建草稿：                              .\发布到草稿箱.ps1
#
# 它做三件事：取 access_token →（可选）上传封面到素材库 → 调 draft/add 建草稿。
# 成功后到公众号后台「草稿箱」确认排版，再手动群发。

[CmdletBinding()]
param(
    [string]$ConfigPath = (Join-Path $PSScriptRoot 'wechat-config.json'),
    [string]$HtmlPath   = (Join-Path $PSScriptRoot '排版稿.html'),
    [string]$Title      = '别急着花三万块学「造AI」了！AI越能自己造自己，这门手艺越不值钱',
    [string]$Author     = '',
    [string]$Digest     = 'AI 都能自己造自己了，最不值钱的恰恰是「亲手造 AI」。教你一个测试，判断你正在学的技能是在贬值还是升值，以及普通人的机会到底藏在哪条缝里。',
    [string]$CoverPath  = '',
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Write-Host ("运行环境：PowerShell " + $PSVersionTable.PSVersion.ToString()) -ForegroundColor DarkGray

# ---------- 常见错误码说明 ----------
$ErrMap = @{
    '40001' = 'access_token 无效，重跑脚本即可'
    '42001' = 'access_token 已过期，重跑脚本即可'
    '40013' = 'AppID 无效，检查 config 里的 appid'
    '40125' = 'AppSecret 无效，去后台「基本配置」重置开发者密码'
    '40164' = '调用方 IP 不在白名单：把本机公网 IP 加进「设置与开发 → 基本配置 → IP白名单」'
    '41001' = '缺少 access_token 参数'
    '48001' = '接口未授权：这个号没有「草稿箱/发布」接口权限（个人未认证订阅号常见）'
    '45009' = '接口调用频率超限，等几分钟再试'
    '45002' = '内容长度或格式不合规'
    '40007' = 'thumb_media_id 无效'
    '40008' = '消息格式错误，检查 JSON body'
    '53500' = '主体或认证状态不满足该接口要求'
}
function Show-Err($obj) {
    $c = "$($obj.errcode)"; $m = "$($obj.errmsg)"
    $hint = if ($ErrMap.ContainsKey($c)) { $ErrMap[$c] } else { '（未收录，请照 errmsg 搜索官方文档）' }
    Write-Host "微信返回错误：errcode=$c  errmsg=$m" -ForegroundColor Red
    Write-Host "   → 处理建议：$hint" -ForegroundColor Yellow
}

# ---------- multipart 上传（PS 5.1 没有 -Form，手写请求体） ----------
function Send-ImageFile($url, $filePath) {
    $boundary = [Guid]::NewGuid().ToString('N')
    $fileBytes = [IO.File]::ReadAllBytes($filePath)
    # 固定用 ASCII 文件名，避免中文文件名在 multipart 头里被错误编码
    $ext = [IO.Path]::GetExtension($filePath)
    if (-not $ext) { $ext = '.png' }
    $head = "--$boundary`r`n" +
            "Content-Disposition: form-data; name=`"media`"; filename=`"cover$ext`"`r`n" +
            "Content-Type: application/octet-stream`r`n`r`n"
    $headBytes = [Text.Encoding]::UTF8.GetBytes($head)
    $tailBytes = [Text.Encoding]::UTF8.GetBytes("`r`n--$boundary--`r`n")
    $body = New-Object byte[] ($headBytes.Length + $fileBytes.Length + $tailBytes.Length)
    [Array]::Copy($headBytes, 0, $body, 0, $headBytes.Length)
    [Array]::Copy($fileBytes, 0, $body, $headBytes.Length, $fileBytes.Length)
    [Array]::Copy($tailBytes, 0, $body, $headBytes.Length + $fileBytes.Length, $tailBytes.Length)
    return Invoke-RestMethod -Uri $url -Method Post -ContentType "multipart/form-data; boundary=$boundary" `
        -Body $body -TimeoutSec 60
}

# ---------- 读取凭据 ----------
$appid  = $env:WECHAT_APPID
$secret = $env:WECHAT_SECRET
if (Test-Path $ConfigPath) {
    $cfg = Get-Content -Raw -Encoding UTF8 $ConfigPath | ConvertFrom-Json
    if ($cfg.appid)  { $appid  = $cfg.appid }
    if ($cfg.secret) { $secret = $cfg.secret }
    if (-not $Author -and $cfg.author) { $Author = $cfg.author }
}
if (-not $DryRun) {
    if (-not $appid -or -not $secret) { throw "缺少凭据：请填写 $ConfigPath，或设置环境变量 WECHAT_APPID / WECHAT_SECRET。" }
    if ($appid -notlike 'wx*') { Write-Warning "appid 通常以 wx 开头（18 位），你填的是：$appid。gh_ 开头的是原始ID，不能用于调用接口。" }
} else {
    Write-Host "DryRun 模式：不校验凭据、不联网，只生成请求体。" -ForegroundColor Yellow
}

# ---------- 读取正文 HTML ----------
if (-not (Test-Path $HtmlPath)) { throw "找不到正文文件：$HtmlPath" }
$raw = Get-Content -Raw -Encoding UTF8 $HtmlPath
$m = [regex]::Match($raw, '(?s)<body[^>]*>(.*)</body>')
$content = if ($m.Success) { $m.Groups[1].Value } else { $raw }
$content = [regex]::Replace($content, '(?s)<!--.*?-->', '').Trim()
Write-Host "正文已读取：$($content.Length) 字符" -ForegroundColor Cyan
if ($content.Length -lt 500) { Write-Warning "正文长度偏短，检查 排版稿.html 是否完整。" }

# ---------- DryRun ----------
if ($DryRun) {
    $preview = [ordered]@{ articles = @([ordered]@{
        title = $Title; author = $Author; digest = $Digest
        content = $content; thumb_media_id = ''; need_open_comment = 1; only_fans_can_comment = 0
    }) }
    $out = Join-Path $PSScriptRoot 'dryrun-body.json'
    $preview | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $out
    Write-Host "DryRun 完成：未调用接口，请求体已写入 $out" -ForegroundColor Green
    return
}

# ---------- 1) access_token ----------
$tokUrl = "https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=$appid&secret=$secret"
$tok = Invoke-RestMethod -Uri $tokUrl -Method Get -TimeoutSec 30
if (-not $tok.access_token) { Show-Err $tok; throw '获取 access_token 失败' }
$token = $tok.access_token
Write-Host "1/3 access_token 获取成功" -ForegroundColor Green

# ---------- 2) 封面（可选） ----------
$thumbId = ''
if ($CoverPath -and (Test-Path $CoverPath)) {
    $up = Send-ImageFile "https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=$token&type=image" $CoverPath
    if (-not $up.media_id) { Show-Err $up; throw '封面上传失败' }
    $thumbId = $up.media_id
    Write-Host "2/3 封面上传成功 media_id=$thumbId" -ForegroundColor Green
} else {
    Write-Host "2/3 未提供封面，跳过（-CoverPath 可指定；也可在后台草稿里再选封面）" -ForegroundColor DarkGray
}

# ---------- 3) 建草稿 ----------
$body = [ordered]@{ articles = @([ordered]@{
    title                 = $Title
    author                = $Author
    digest                = $Digest
    content               = $content
    content_source_url    = ''
    thumb_media_id        = $thumbId
    need_open_comment     = 1
    only_fans_can_comment = 0
}) }
$json = $body | ConvertTo-Json -Depth 6 -Compress
$res = Invoke-RestMethod -Uri "https://api.weixin.qq.com/cgi-bin/draft/add?access_token=$token" `
    -Method Post -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 60

if ($res.media_id) {
    Write-Host "3/3 草稿创建成功！media_id=$($res.media_id)" -ForegroundColor Green
    Write-Host "去公众号后台 →「草稿箱」查看：https://mp.weixin.qq.com/" -ForegroundColor Green
    Write-Host "注意：本脚本只创建草稿，不会群发。请人工确认排版后再发布。" -ForegroundColor Yellow
} else {
    Show-Err $res
    throw '创建草稿失败'
}
