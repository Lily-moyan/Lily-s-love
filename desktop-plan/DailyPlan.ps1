#Requires -Version 5.1
<#
    每日工作计划栏 · 桌面小浮窗
    Windows PowerShell 5.1 + WPF，无第三方依赖。
    用法：powershell -STA -NoProfile -ExecutionPolicy Bypass -File DailyPlan.ps1
#>
[CmdletBinding()]
param(
    [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- 路径
if ($PSScriptRoot) { $script:AppRoot = $PSScriptRoot }
else { $script:AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition }

$script:DataDir  = Join-Path $script:AppRoot 'data'
$script:DataFile = Join-Path $script:DataDir  'plan.json'
$script:UiFile   = Join-Path $script:DataDir  'ui.json'
$script:LogFile  = Join-Path $script:DataDir  'app.log'

if (-not (Test-Path -LiteralPath $script:DataDir)) {
    New-Item -ItemType Directory -Path $script:DataDir -Force | Out-Null
}

function Write-Log([string]$Message) {
    try {
        $line = '{0}  {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
        Add-Content -LiteralPath $script:LogFile -Value $line -Encoding UTF8
    } catch { }
}

# ---------------------------------------------------------------- 单实例保护
$script:Mutex = $null
if (-not $SelfTest) {
    $createdNew = $false
    try {
        $script:Mutex = New-Object System.Threading.Mutex($true, 'Local\DshDailyPlanWidget', [ref]$createdNew)
    } catch { $createdNew = $true }
    if (-not $createdNew) {
        Write-Log 'another instance is already running; exit'
        exit 0
    }
}

$script:Tasks    = New-Object System.Collections.ArrayList   # 今天的任务
$script:History  = New-Object System.Collections.ArrayList   # 近 30 天历史
$script:TodayKey = (Get-Date).ToString('yyyy-MM-dd')
$script:ExpandedHeight = 476
$script:Collapsed      = $false

# ---------------------------------------------------------------- 数据读写
function Load-Data {
    $script:Tasks    = New-Object System.Collections.ArrayList
    $script:History  = New-Object System.Collections.ArrayList
    $script:TodayKey = (Get-Date).ToString('yyyy-MM-dd')

    if (-not (Test-Path -LiteralPath $script:DataFile)) { return }
    try {
        $raw = Get-Content -LiteralPath $script:DataFile -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) { return }
        $doc = $raw | ConvertFrom-Json
        $cut = (Get-Date).Date.AddDays(-30)

        foreach ($item in @($doc.tasks)) {
            if ($null -eq $item) { continue }
            $d = [string]$item.date
            if ([string]::IsNullOrWhiteSpace($d)) { continue }
            $h = @{ date = $d; text = [string]$item.text; done = [bool]$item.done }
            if ($d -eq $script:TodayKey) {
                [void]$script:Tasks.Add($h)
            }
            else {
                $parsed = [datetime]::MinValue
                if ([datetime]::TryParse($d, [ref]$parsed)) {
                    if ($parsed -ge $cut) { [void]$script:History.Add($h) }
                }
            }
        }
    }
    catch { Write-Log "load failed: $($_.Exception.Message)" }
}

function Save-Data {
    try {
        $all = New-Object System.Collections.ArrayList
        foreach ($h in $script:History) { [void]$all.Add($h) }
        foreach ($h in $script:Tasks)   { [void]$all.Add($h) }

        $doc = [ordered]@{
            version = 2
            savedAt = (Get-Date).ToString('s')
            tasks   = @($all.ToArray())
        }
        ($doc | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $script:DataFile -Encoding UTF8
    }
    catch { Write-Log "save failed: $($_.Exception.Message)" }
}

function Load-Ui {
    $ui = @{ left = $null; top = $null; collapsed = $false }
    if (-not (Test-Path -LiteralPath $script:UiFile)) { return $ui }
    try {
        $raw = Get-Content -LiteralPath $script:UiFile -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) { return $ui }
        $o = $raw | ConvertFrom-Json
        if ($null -ne $o.left)      { $ui.left = [double]$o.left }
        if ($null -ne $o.top)       { $ui.top = [double]$o.top }
        if ($null -ne $o.collapsed) { $ui.collapsed = [bool]$o.collapsed }
    }
    catch { Write-Log "ui load failed: $($_.Exception.Message)" }
    return $ui
}

function Save-Ui($left, $top, $collapsed) {
    try {
        $doc = [ordered]@{ left = $left; top = $top; collapsed = $collapsed }
        ($doc | ConvertTo-Json) | Set-Content -LiteralPath $script:UiFile -Encoding UTF8
    }
    catch { Write-Log "ui save failed: $($_.Exception.Message)" }
}

# ---------------------------------------------------------------- XAML
Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="每日工作计划" Width="336" Height="476"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="NoResize"
        WindowStartupLocation="Manual" SnapsToDevicePixels="True"
        UseLayoutRounding="True" FontFamily="Microsoft YaHei UI, Microsoft YaHei, Segoe UI">

  <Window.Resources>
    <Style x:Key="IconBtn" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="#591E3A8A"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Width" Value="24"/>
      <Setter Property="Height" Value="24"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bg" CornerRadius="7" Background="{TemplateBinding Background}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bg" Property="Background" Value="#1F000000"/>
                <Setter Property="Foreground" Value="#CC1E3A8A"/>
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="bg" Property="Background" Value="#33000000"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="GhostBtn" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="#591E3A8A"/>
      <Setter Property="BorderThickness" Value="0"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FontSize" Value="11"/>
      <Setter Property="Padding" Value="9,5"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bg" CornerRadius="7" Background="{TemplateBinding Background}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"
                                Margin="{TemplateBinding Padding}"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bg" Property="Background" Value="#1F000000"/>
                <Setter Property="Foreground" Value="#CC1E3A8A"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="PrimaryBtn" TargetType="Button">
      <Setter Property="Foreground" Value="#FFFFFF"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="Padding" Value="14,7"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bg" CornerRadius="8" Background="#4F8CFF">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"
                                Margin="{TemplateBinding Padding}"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bg" Property="Background" Value="#6BA0FF"/>
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="bg" Property="Background" Value="#3C74D8"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <Style x:Key="SlimBar" TargetType="ScrollBar">
      <Setter Property="Width" Value="6"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ScrollBar">
            <Grid Background="Transparent">
              <Track x:Name="PART_Track" IsDirectionReversed="True">
                <Track.DecreaseRepeatButton>
                  <RepeatButton Command="ScrollBar.PageUpCommand" Opacity="0" Focusable="False"/>
                </Track.DecreaseRepeatButton>
                <Track.Thumb>
                  <Thumb>
                    <Thumb.Template>
                      <ControlTemplate TargetType="Thumb">
                        <Border CornerRadius="3" Background="#3A3F4C"/>
                      </ControlTemplate>
                    </Thumb.Template>
                  </Thumb>
                </Track.Thumb>
                <Track.IncreaseRepeatButton>
                  <RepeatButton Command="ScrollBar.PageDownCommand" Opacity="0" Focusable="False"/>
                </Track.IncreaseRepeatButton>
              </Track>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>

  <!-- 背景不透明度 10%：alpha 0x1A = 26/255 ≈ 10% 不透明（90% 透明） -->
  <!-- 文字统一深蓝 #1E3A8A：主文字 50% 不透明(#80)，次级文字 35% (#59) -->
  <Border x:Name="Root" CornerRadius="12"
          Background="#1A191B22" BorderBrush="#33FFFFFF" BorderThickness="1">

    <Border.ContextMenu>
      <ContextMenu>
        <MenuItem x:Name="MenuCollapse" Header="收起 / 展开"/>
        <MenuItem x:Name="MenuReload"   Header="重新载入今日"/>
        <Separator/>
        <MenuItem x:Name="MenuExit"     Header="退出"/>
      </ContextMenu>
    </Border.ContextMenu>

    <Grid Margin="14,12,14,12">
      <Grid.RowDefinitions>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="*"/>
        <RowDefinition Height="Auto"/>
        <RowDefinition Height="Auto"/>
      </Grid.RowDefinitions>

      <!-- 标题 + 日期（拖拽区） -->
      <Grid x:Name="Header" Grid.Row="0" Background="Transparent" Margin="0,0,0,10">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <StackPanel Grid.Column="0" VerticalAlignment="Center">
          <TextBlock Text="每日工作计划" FontSize="14" FontWeight="SemiBold" Foreground="#801E3A8A"/>
          <TextBlock x:Name="DateText" Text="—" FontSize="11" Foreground="#591E3A8A" Margin="0,3,0,0"/>
        </StackPanel>
        <StackPanel Grid.Column="1" Orientation="Horizontal" VerticalAlignment="Top">
          <Button x:Name="BtnCollapse" Style="{StaticResource IconBtn}" Content="—" ToolTip="收起为细条"/>
          <Button x:Name="BtnClose"    Style="{StaticResource IconBtn}" Content="✕" Margin="4,0,0,0" ToolTip="关闭"/>
        </StackPanel>
      </Grid>

      <!-- 进度 -->
      <Grid x:Name="ProgressBlock" Grid.Row="1" Margin="0,0,0,10">
        <Grid.RowDefinitions>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>
        <Grid Grid.Row="0" Margin="0,0,0,6">
          <TextBlock Text="今日进度" FontSize="11" Foreground="#591E3A8A" HorizontalAlignment="Left"/>
          <TextBlock x:Name="StatText" Text="0 / 0" FontSize="11" Foreground="#591E3A8A" HorizontalAlignment="Right"/>
        </Grid>
        <ProgressBar x:Name="Bar" Grid.Row="1" Height="5" Minimum="0" Maximum="1" Value="0"
                     Background="#331E3A8A" Foreground="#4F8CFF" BorderThickness="0">
          <ProgressBar.Template>
            <ControlTemplate TargetType="ProgressBar">
              <Grid>
                <Border CornerRadius="3" Background="{TemplateBinding Background}"/>
                <Border x:Name="PART_Track"/>
                <Border x:Name="PART_Indicator" CornerRadius="3" HorizontalAlignment="Left"
                        Background="{TemplateBinding Foreground}"/>
              </Grid>
            </ControlTemplate>
          </ProgressBar.Template>
        </ProgressBar>
      </Grid>

      <Border x:Name="RowSep" Grid.Row="2" Height="1" Background="#1AFFFFFF" Margin="0,0,0,8"/>

      <!-- 任务列表 -->
      <ScrollViewer x:Name="ListScroll" Grid.Row="3" VerticalScrollBarVisibility="Auto"
                    HorizontalScrollBarVisibility="Disabled" Padding="0,0,4,0">
        <ScrollViewer.Resources>
          <Style TargetType="ScrollBar" BasedOn="{StaticResource SlimBar}"/>
        </ScrollViewer.Resources>
        <StackPanel x:Name="TaskList"/>
      </ScrollViewer>

      <!-- 添加 -->
      <Grid x:Name="AddRow" Grid.Row="4" Margin="0,10,0,0">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="*"/>
          <ColumnDefinition Width="Auto"/>
        </Grid.ColumnDefinitions>
        <Border Grid.Column="0" CornerRadius="8" Background="#1A000000"
                BorderBrush="#26000000" BorderThickness="1">
          <Grid>
            <TextBlock x:Name="Placeholder" Text="添加今日任务，回车确认" FontSize="12"
                       Foreground="#661E3A8A" Margin="11,0,0,0" VerticalAlignment="Center"
                       IsHitTestVisible="False"/>
            <TextBox x:Name="TxtInput" Background="Transparent" BorderThickness="0"
                     Foreground="#CC1E3A8A" CaretBrush="#4F8CFF" FontSize="12"
                     Padding="10,7,10,7" VerticalContentAlignment="Center"/>
          </Grid>
        </Border>
        <Button x:Name="BtnAdd" Grid.Column="1" Style="{StaticResource PrimaryBtn}"
                Content="添加" Margin="8,0,0,0"/>
      </Grid>

      <!-- 底部 -->
      <Grid x:Name="Footer" Grid.Row="5" Margin="0,10,0,0">
        <TextBlock x:Name="HintText" Text="自动保存" FontSize="10" Foreground="#591E3A8A"
                   HorizontalAlignment="Left" VerticalAlignment="Center"/>
        <Button x:Name="BtnClearDone" Style="{StaticResource GhostBtn}" Content="清空已完成"
                HorizontalAlignment="Right" VerticalAlignment="Center"/>
      </Grid>
    </Grid>
  </Border>
</Window>
'@

# ---------------------------------------------------------------- 载入界面
$script:Win = $null
try {
    $script:Win = [System.Windows.Markup.XamlReader]::Parse($xaml)
}
catch {
    Write-Log "xaml parse failed: $($_.Exception.Message)"
    if (-not $SelfTest) {
        [void][System.Windows.MessageBox]::Show("界面载入失败：`n$($_.Exception.Message)", '每日工作计划栏')
    }
    exit 1
}

$W = $script:Win
foreach ($n in @('Root','Header','DateText','BtnCollapse','BtnClose','ProgressBlock','StatText','Bar',
                 'RowSep','ListScroll','TaskList','AddRow','Placeholder','TxtInput','BtnAdd',
                 'Footer','HintText','BtnClearDone','MenuCollapse','MenuReload','MenuExit')) {
    $v = $W.FindName($n)
    if ($null -eq $v) {
        Write-Log "control not found: $n"
        if (-not $SelfTest) {
            [void][System.Windows.MessageBox]::Show("界面元素缺失：$n", '每日工作计划栏')
        }
        exit 1
    }
    Set-Variable -Name $n -Value $v -Scope Script
}

# ---------------------------------------------------------------- 渲染
function Render-Tasks {
    $TaskList.Children.Clear()

    if ($script:Tasks.Count -eq 0) {
        $empty = New-Object System.Windows.Controls.TextBlock
        $empty.Text = "今天还没有任务`n在下面输入框里加一条吧"
        $empty.FontSize = 12
        $empty.Foreground = '#591E3A8A'
        $empty.TextAlignment = 'Center'
        $empty.Margin = New-Object System.Windows.Thickness(0, 26, 0, 0)
        $empty.LineHeight = 20
        [void]$TaskList.Children.Add($empty)
    }
    else {
        foreach ($task in @($script:Tasks)) {
            $row = New-Object System.Windows.Controls.Grid
            $row.Margin = New-Object System.Windows.Thickness(0, 1, 0, 5)

            $c1 = New-Object System.Windows.Controls.ColumnDefinition
            $c1.Width = [System.Windows.GridLength]::Auto
            $c2 = New-Object System.Windows.Controls.ColumnDefinition
            $c2.Width = [System.Windows.GridLength]::new(1, [System.Windows.GridUnitType]::Star)
            $c3 = New-Object System.Windows.Controls.ColumnDefinition
            $c3.Width = [System.Windows.GridLength]::Auto
            [void]$row.ColumnDefinitions.Add($c1)
            [void]$row.ColumnDefinitions.Add($c2)
            [void]$row.ColumnDefinitions.Add($c3)

            $cb = New-Object System.Windows.Controls.CheckBox
            $cb.IsChecked = [bool]$task.done
            $cb.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
            $cb.Margin = New-Object System.Windows.Thickness(0, 0, 9, 0)
            $cb.Cursor = [System.Windows.Input.Cursors]::Hand
            $cb.Tag = $task
            $cb.Add_Click($script:OnToggle)

            $tb = New-Object System.Windows.Controls.TextBlock
            $tb.Text = [string]$task.text
            $tb.FontSize = 12.5
            $tb.TextWrapping = [System.Windows.TextWrapping]::Wrap
            $tb.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
            if ($task.done) {
                $tb.Foreground = '#4D1E3A8A'
                $tb.TextDecorations = [System.Windows.TextDecorations]::Strikethrough
            }
            else {
                $tb.Foreground = '#801E3A8A'
            }

            $del = New-Object System.Windows.Controls.Button
            $del.Style = $W.FindResource('IconBtn')
            $del.Content = '✕'
            $del.FontSize = 10
            $del.Width = 20
            $del.Height = 20
            $del.Margin = New-Object System.Windows.Thickness(6, 0, 0, 0)
            $del.VerticalAlignment = [System.Windows.VerticalAlignment]::Center
            $del.ToolTip = '删除'
            $del.Tag = $task
            $del.Add_Click($script:OnDelete)

            [System.Windows.Controls.Grid]::SetColumn($cb, 0)
            [System.Windows.Controls.Grid]::SetColumn($tb, 1)
            [System.Windows.Controls.Grid]::SetColumn($del, 2)
            [void]$row.Children.Add($cb)
            [void]$row.Children.Add($tb)
            [void]$row.Children.Add($del)

            [void]$TaskList.Children.Add($row)
        }
    }
    Update-Stats
}

function Update-Stats {
    $total = $script:Tasks.Count
    $done  = 0
    foreach ($t in $script:Tasks) { if ($t.done) { $done++ } }
    $StatText.Text = "$done / $total"
    if ($total -gt 0) { $Bar.Value = $done / $total } else { $Bar.Value = 0 }
    if ($done -ge $total -and $total -gt 0) { $HintText.Text = '今天的任务全部完成 ✓' }
    elseif ($total -eq 0)                  { $HintText.Text = '自动保存' }
    else                                   { $HintText.Text = "还剩 $($total - $done) 项 · 自动保存" }
}

function Set-HeaderDate {
    $now = Get-Date
    $wd = @('周日','周一','周二','周三','周四','周五','周六')[[int]$now.DayOfWeek]
    $DateText.Text = '{0}  {1}' -f $now.ToString('yyyy年M月d日'), $wd
}

function Add-Task([string]$text) {
    $text = $text.Trim()
    if ([string]::IsNullOrWhiteSpace($text)) { return }
    $t = @{ date = $script:TodayKey; text = $text; done = $false }
    [void]$script:Tasks.Add($t)
    Save-Data
    Render-Tasks
    $TxtInput.Text = ''
    $TxtInput.Focus() | Out-Null
    $ListScroll.ScrollToEnd()
}

function Set-Collapsed([bool]$collapsed) {
    if ($collapsed) {
        $RowSep.Visibility       = 'Collapsed'
        $ListScroll.Visibility   = 'Collapsed'
        $AddRow.Visibility       = 'Collapsed'
        $Footer.Visibility       = 'Collapsed'
        $BtnCollapse.Content     = '▸'
        $BtnCollapse.ToolTip     = '展开'
        $W.SizeToContent         = [System.Windows.SizeToContent]::Height
    }
    else {
        $W.SizeToContent         = [System.Windows.SizeToContent]::Manual
        $W.Height                = $script:ExpandedHeight
        $RowSep.Visibility       = 'Visible'
        $ListScroll.Visibility   = 'Visible'
        $AddRow.Visibility       = 'Visible'
        $Footer.Visibility       = 'Visible'
        $BtnCollapse.Content     = '—'
        $BtnCollapse.ToolTip     = '收起为细条'
    }
    $script:Collapsed = $collapsed
}

# ---------------------------------------------------------------- 事件
$script:OnToggle = {
    param($sender, $e)
    $task = $sender.Tag
    if ($null -ne $task) {
        $task.done = [bool]$sender.IsChecked
        Save-Data
        # 事件处理完后再重绘，避免销毁正在响应事件的控件
        [void]$sender.Dispatcher.BeginInvoke(
            [System.Windows.Threading.DispatcherPriority]::Background,
            [Action]{ Render-Tasks })
    }
}

$script:OnDelete = {
    param($sender, $e)
    $task = $sender.Tag
    if ($null -ne $task) {
        [void]$script:Tasks.Remove($task)
        Save-Data
        [void]$sender.Dispatcher.BeginInvoke(
            [System.Windows.Threading.DispatcherPriority]::Background,
            [Action]{ Render-Tasks })
    }
}

$Header.Add_MouseLeftButtonDown({
    param($sender, $e)
    try { $W.DragMove() } catch { }
})

$BtnClose.Add_Click({ $W.Close() })
$BtnCollapse.Add_Click({ Set-Collapsed (-not $script:Collapsed) })
$BtnAdd.Add_Click({ Add-Task $TxtInput.Text })
$BtnClearDone.Add_Click({
    $keep = New-Object System.Collections.ArrayList
    foreach ($t in $script:Tasks) { if (-not $t.done) { [void]$keep.Add($t) } }
    $script:Tasks = $keep
    Save-Data
    Render-Tasks
})
$MenuCollapse.Add_Click({ Set-Collapsed (-not $script:Collapsed) })
$MenuReload.Add_Click({
    Load-Data
    Set-HeaderDate
    Render-Tasks
})
$MenuExit.Add_Click({ $W.Close() })

$TxtInput.Add_KeyDown({
    param($sender, $e)
    if ($e.Key -eq [System.Windows.Input.Key]::Return) {
        Add-Task $script:TxtInput.Text
        $e.Handled = $true
    }
})
$TxtInput.Add_TextChanged({
    if ([string]::IsNullOrEmpty($script:TxtInput.Text)) { $script:Placeholder.Visibility = 'Visible' }
    else { $script:Placeholder.Visibility = 'Collapsed' }
})

$W.Add_Closed({
    try {
        Save-Data
        Save-Ui $W.Left $W.Top $script:Collapsed
    } catch { Write-Log "close save failed: $($_.Exception.Message)" }
})

# 分层窗口由 XAML 的 AllowsTransparency 处理，圆角由 Border.CornerRadius 提供

# ---------------------------------------------------------------- 启动
Load-Data
Set-HeaderDate
Render-Tasks

$script:Ui = Load-Ui
$wa = [System.Windows.SystemParameters]::WorkArea
if ($null -ne $script:Ui.left -and $null -ne $script:Ui.top) {
    $W.Left = $script:Ui.left
    $W.Top  = $script:Ui.top
}
else {
    $W.Left = [math]::Max($wa.Left, $wa.Right - $W.Width - 20)
    $W.Top  = $wa.Top + 24
}

if ($SelfTest) {
    Write-Host ('SELFTEST OK  height={0}  left={1}  top={2}  tasks={3}  history={4}' -f `
        $W.Height, $W.Left, $W.Top, $script:Tasks.Count, $script:History.Count)
    exit 0
}

Set-Collapsed ([bool]$script:Ui.collapsed)

# 跨天自动切换到新的一天
$script:DayTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:DayTimer.Interval = [TimeSpan]::FromSeconds(60)
$script:DayTimer.Add_Tick({
    if ((Get-Date).ToString('yyyy-MM-dd') -ne $script:TodayKey) {
        Load-Data
        Set-HeaderDate
        Render-Tasks
    }
})
$script:DayTimer.Start()

Write-Log ("started  pid={0}  left={1}  top={2}  collapsed={3}" -f $PID, $W.Left, $W.Top, $script:Collapsed)

# 事件处理器内的异常不要终止消息循环
$ErrorActionPreference = 'Continue'

try {
    $app = New-Object System.Windows.Application
    $app.ShutdownMode = [System.Windows.ShutdownMode]::OnMainWindowClose
    [void]$app.Run($W)
}
catch {
    Write-Log "run failed: $($_.Exception.Message)"
    throw
}
finally {
    if ($script:DayTimer) { $script:DayTimer.Stop() }
    Write-Log 'exited'
}
