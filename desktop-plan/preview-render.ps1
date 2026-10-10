# 开发用工具：把界面按真实 alpha 渲染出来，再合成到浅/中/深三种桌面底色上。
# 用途：判断半透明面板下文字的对比度是否够用。
# 用法：powershell -NoProfile -STA -File preview-render.ps1
param([string]$OutDir = $PSScriptRoot)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName System.Drawing

$W = 336
$H = 476

# ---- 从主程序里取出同一份 XAML，保证预览和实际界面一致 ----
$appFile = Join-Path $PSScriptRoot 'DailyPlan.ps1'
$src = Get-Content -LiteralPath $appFile -Raw -Encoding UTF8
$m = [regex]::Match($src, '(?s)\$xaml = @''\r?\n(.*?)\r?\n''@')
if (-not $m.Success) { throw 'XAML 提取失败' }

$win  = [System.Windows.Markup.XamlReader]::Parse($m.Groups[1].Value)
$root = $win.FindName('Root')
$win.Content = $null          # 脱离 Window 独立布局，避免未创建 HWND 的影响

# ---- 填真实内容 ----
$now = Get-Date
$wd  = @('周日','周一','周二','周三','周四','周五','周六')[[int]$now.DayOfWeek]
$win.FindName('DateText').Text = '{0}  {1}' -f $now.ToString('yyyy年M月d日'), $wd

$today    = $now.ToString('yyyy-MM-dd')
$dataFile = Join-Path $PSScriptRoot 'data\plan.json'
$tasks    = @()
if (Test-Path -LiteralPath $dataFile) {
    $doc   = (Get-Content -LiteralPath $dataFile -Raw -Encoding UTF8) | ConvertFrom-Json
    $tasks = @(@($doc.tasks) | Where-Object { $_.date -eq $today } | Select-Object -First 4)
}
if ($tasks.Count -eq 0) {
    $tasks = @(
        [pscustomobject]@{ text = '示例任务：把视频剪出来发布'; done = $false },
        [pscustomobject]@{ text = '示例任务：写周报';           done = $true  }
    )
}

$list = $win.FindName('TaskList')
foreach ($t in $tasks) {
    $row    = New-Object System.Windows.Controls.Grid
    $row.Margin = New-Object System.Windows.Thickness(0, 1, 0, 5)
    $c1 = New-Object System.Windows.Controls.ColumnDefinition
    $c1.Width = [System.Windows.GridLength]::Auto
    $c2 = New-Object System.Windows.Controls.ColumnDefinition
    $c2.Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star)
    [void]$row.ColumnDefinitions.Add($c1)
    [void]$row.ColumnDefinitions.Add($c2)

    $cb = New-Object System.Windows.Controls.CheckBox
    $cb.IsChecked       = [bool]$t.done
    $cb.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    $cb.Margin          = New-Object System.Windows.Thickness(0, 0, 9, 0)

    $tb = New-Object System.Windows.Controls.TextBlock
    $tb.Text             = [string]$t.text
    $tb.FontSize         = 12.5
    $tb.TextWrapping     = [System.Windows.TextWrapping]::Wrap
    $tb.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
    if ($t.done) {
        $tb.Foreground     = '#4D1E3A8A'
        $tb.TextDecorations = [System.Windows.TextDecorations]::Strikethrough
    }
    else { $tb.Foreground = '#801E3A8A' }

    [System.Windows.Controls.Grid]::SetColumn($cb, 0)
    [System.Windows.Controls.Grid]::SetColumn($tb, 1)
    [void]$row.Children.Add($cb)
    [void]$row.Children.Add($tb)
    [void]$list.Children.Add($row)
}

$done = @($tasks | Where-Object { $_.done }).Count
$win.FindName('StatText').Text = "$done / $($tasks.Count)"
$win.FindName('Bar').Value = $(if ($tasks.Count -gt 0) { $done / $tasks.Count } else { 0 })
$win.FindName('HintText').Text = "还剩 $($tasks.Count - $done) 项 · 自动保存"

# ---- 布局并渲染成带 alpha 的位图 ----
$size = New-Object System.Windows.Size($W, $H)
$root.Measure($size)
$root.Arrange((New-Object System.Windows.Rect(0, 0, $W, $H)))
$root.UpdateLayout()

$rtb = New-Object System.Windows.Media.Imaging.RenderTargetBitmap(
    $W, $H, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
$rtb.Render($root)

$enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
[void]$enc.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($rtb))
$rgba = Join-Path $OutDir 'preview-rgba.png'
$fs = [System.IO.File]::Create($rgba)
$enc.Save($fs)
$fs.Close()
"alpha 渲染图 -> $rgba"

# ---- 合成到不同桌面底色 ----
$overlay = [System.Drawing.Image]::FromFile($rgba)
$backdrops = [ordered]@{
    'preview-on-light.png' = [System.Drawing.Color]::White
    'preview-on-mid.png'   = [System.Drawing.Color]::FromArgb(128, 128, 128)
    'preview-on-dark.png'  = [System.Drawing.Color]::FromArgb(20, 22, 30)
}
foreach ($k in $backdrops.Keys) {
    $bmp = New-Object System.Drawing.Bitmap($W, $H)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear($backdrops[$k])
    $g.DrawImage($overlay, 0, 0, $W, $H)
    $g.Dispose()
    $p = Join-Path $OutDir $k
    $bmp.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    "合成图 -> $p"
}
$overlay.Dispose()
