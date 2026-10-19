param([ValidateSet('Install', 'Remove')][string]$Action = 'Install')
$ErrorActionPreference = 'Stop'
$pluginDirectory = $PSScriptRoot
$magpieCommand = Get-Command magpie -ErrorAction SilentlyContinue
$magpieExecutable = if ($env:MAGPIE_EXE) { $env:MAGPIE_EXE } elseif ($magpieCommand) { $magpieCommand.Source } else { Join-Path ([Environment]::GetFolderPath('Desktop')) 'magpie-windows-amd64.exe' }
if (-not (Test-Path -LiteralPath $magpieExecutable)) { throw '找不到 Magpie。请在 Magpie 插件页添加本文件夹。' }

function Invoke-MagpieCommand([string]$Arguments) {
    # PowerShell 5 does not wait for a GUI-subsystem EXE invoked with &.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $magpieExecutable
    $startInfo.Arguments = $Arguments
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
function Invoke-MagpiePlugin([string]$Operation) {
    Invoke-MagpieCommand ('plugin ' + $Operation + ' "' + $pluginSpec + '"')
}

$configBase = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.config' }
$pluginsPath = Join-Path $configBase 'magpie\plugins.json'
$pluginSpec = $pluginDirectory
if ($Action -eq 'Remove' -and (Test-Path -LiteralPath $pluginsPath)) {
    $installed = (Get-Content -LiteralPath $pluginsPath -Raw -Encoding UTF8 | ConvertFrom-Json).plugins
    $matches = @($installed | Where-Object { $_.spec -eq $pluginDirectory -or $_.spec -match '(^|[/:\\])magpie-agent-proma(\.git)?([#@/]|$)' })
    if ($matches.Count -gt 1) { throw '发现多个安装记录，请先在 Magpie 中保留一个。' }
    if ($matches.Count -eq 1) { $pluginSpec = $matches[0].spec }
}
function Test-PluginInstalled {
    if (-not (Test-Path -LiteralPath $pluginsPath)) { return $false }
    $config = Get-Content -LiteralPath $pluginsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    return @($config.plugins | Where-Object { $_.spec -eq $pluginSpec }).Count -gt 0
}

if ($Action -eq 'Install') {
    if (Test-PluginInstalled) { Write-Host '已确认：此插件已经安装。' }
    else { Invoke-MagpiePlugin 'add' }
    if (-not (Test-PluginInstalled)) { throw '命令已结束，但未找到插件记录。请在 Magpie 插件页添加本文件夹。' }
    Write-Host '请在 Magpie 的已安装插件中确认本插件已启用，再到 Agent 页开启 Proma 接入。'
} else {
    if (Get-Process -Name Proma -ErrorAction SilentlyContinue) { throw '请先从托盘退出 Proma，再卸载。' }
    # Restore the Agent-owned bridge before stopping its synchronizer.
    $bridgePath = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.proma\magpie-bridge.json'
    if ($matches.Count -eq 1 -and $matches[0].options.bridgeFile) { $bridgePath = $matches[0].options.bridgeFile }
    if ((Test-PluginInstalled) -and (Test-Path -LiteralPath $bridgePath)) {
        $bridgeDocument = Get-Content -LiteralPath $bridgePath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($bridgeDocument.bridge.key) { Invoke-MagpieCommand 'proma default' }
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $pluginDirectory 'run-tool.ps1') -Action cleanup
    if ($LASTEXITCODE -ne 0) { throw '渠道清理未完成；插件保留安装，请排查后重试。' }
    if (Test-PluginInstalled) { Invoke-MagpiePlugin 'remove' }
    if (Test-PluginInstalled) { throw '渠道已清理，插件记录仍存在；请在 Magpie 插件页删除并重启 Magpie。' }
    Write-Host '专用渠道已清理，插件已移除。请重启 Magpie 完成宿主卸载。'
}
