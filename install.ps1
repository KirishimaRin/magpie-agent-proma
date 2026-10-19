param([ValidateSet('Install', 'Remove')][string]$Action = 'Install')
$ErrorActionPreference = 'Stop'
$pluginDirectory = $PSScriptRoot
$magpieCommand = Get-Command magpie -ErrorAction SilentlyContinue
$magpieExecutable = if ($env:MAGPIE_EXE) { $env:MAGPIE_EXE } elseif ($magpieCommand) { $magpieCommand.Source } else { Join-Path ([Environment]::GetFolderPath('Desktop')) 'magpie-windows-amd64.exe' }
if (-not (Test-Path -LiteralPath $magpieExecutable)) { throw '找不到 Magpie。请在 Magpie 插件页添加本文件夹。' }

function Invoke-MagpiePlugin([string]$Operation) {
    # PowerShell 5 does not wait for a GUI-subsystem EXE invoked with &.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $magpieExecutable
    $startInfo.Arguments = 'plugin ' + $Operation + ' "' + $pluginDirectory + '"'
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $startInfo.StandardErrorEncoding = New-Object System.Text.UTF8Encoding($false)
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
        if (-not $process.Start()) { throw 'Magpie 进程启动失败。' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) { throw 'Magpie 命令仍在运行，请查看插件页状态后重试。' }
        if ($stdout.Wait(3000) -and $stdout.Result.Trim()) { Write-Host $stdout.Result.Trim() }
        if ($stderr.Wait(3000) -and $stderr.Result.Trim()) { Write-Host $stderr.Result.Trim() }
        if ($process.ExitCode -ne 0) { throw ('Magpie 命令失败，退出码：' + $process.ExitCode) }
    } finally { $process.Dispose() }
}

$configBase = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.config' }
$pluginsPath = Join-Path $configBase 'magpie\plugins.json'
function Test-PluginInstalled {
    if (-not (Test-Path -LiteralPath $pluginsPath)) { return $false }
    $config = Get-Content -LiteralPath $pluginsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    return @($config.plugins | Where-Object { $_.spec -eq $pluginDirectory }).Count -gt 0
}

if ($Action -eq 'Install') {
    if (Test-PluginInstalled) { Write-Host '已确认：此插件已经安装。' }
    else { Invoke-MagpiePlugin 'add' }
    if (-not (Test-PluginInstalled)) { throw '命令已结束，但未找到插件记录。请在 Magpie 插件页添加本文件夹。' }
    Write-Host '请在 Magpie 的已安装插件中确认本插件已启用，再到 Agent 页开启 Proma 接入。'
} else {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '清理渠道需要 Node.js 22 或更新版本。' }
    if (Get-Process -Name Proma -ErrorAction SilentlyContinue) { throw '请先从托盘退出 Proma，再卸载。' }
    if (Test-PluginInstalled) { Invoke-MagpiePlugin 'remove' }
    if (Test-PluginInstalled) { throw '插件记录仍存在。请在 Magpie 插件页移除，再运行 node sync-engine.cjs --remove。' }
    & node (Join-Path $pluginDirectory 'sync-engine.cjs') --remove
    if ($LASTEXITCODE -ne 0) { throw '请先退出 Proma，重试后再移除插件。' }
}
