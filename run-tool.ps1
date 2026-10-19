param(
    [ValidateSet('doctor', 'cleanup', 'restore')][string]$Action = 'doctor',
    [string]$BackupPath
)
$ErrorActionPreference = 'Stop'
try {
    $runtime = $null
    if ($env:MAGPIE_BUN_EXE -and (Test-Path -LiteralPath $env:MAGPIE_BUN_EXE)) { $runtime = $env:MAGPIE_BUN_EXE }
    if (-not $runtime) {
        $command = Get-Command node -ErrorAction SilentlyContinue
        if ($command) {
            $nodeVersion = & $command.Source --version
            if ($nodeVersion -match '^v(\d+)\.' -and [int]$Matches[1] -ge 22) { $runtime = $command.Source }
        }
    }
    if (-not $runtime) {
        $cacheBase = if ($env:XDG_CACHE_HOME) { $env:XDG_CACHE_HOME } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.cache' }
        $runtime = Get-ChildItem -Path (Join-Path $cacheBase 'magpie\bun\*\magpie-bun.exe') -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $runtime) {
        $command = Get-Command bun -ErrorAction SilentlyContinue
        if ($command) { $runtime = $command.Source }
    }
    if (-not $runtime) { throw '未找到运行时。请先在 Magpie 启用本插件，或设置 MAGPIE_BUN_EXE。' }
    $arguments = @((Join-Path $PSScriptRoot 'plugin-tools.cjs'), $Action)
    if ($Action -eq 'restore') {
        if (-not $BackupPath) { throw '请把 channels.json.magpie-backup-* 备份文件拖到 restore.cmd 上。' }
        $arguments += $BackupPath
    }
    & $runtime @arguments
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
