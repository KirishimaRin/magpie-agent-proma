$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..\.smoke\official-compatibility'
New-Item -ItemType Directory -Path $root -Force | Out-Null
$package = Join-Path $root 'proma_0.19.58_amd64.deb'
$url = 'https://github.com/proma-ai/Proma/releases/download/v0.19.58/proma_0.19.58_amd64.deb'
node (Join-Path $PSScriptRoot 'download.cjs') $url $package '89585a5b0dcc546611f3dbe77fde2f0361139d61b47ec70c5944f222b6738a84'
if ($LASTEXITCODE -ne 0) { throw 'Official Proma package download failed' }
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash.ToLowerInvariant() -ne '89585a5b0dcc546611f3dbe77fde2f0361139d61b47ec70c5944f222b6738a84') { throw 'Proma package checksum mismatch' }
# Windows bsdtar reads ar/deb and the nested compressed tar without installing anything.
$outer = Join-Path $root 'deb'
New-Item -ItemType Directory -Path $outer -Force | Out-Null
& tar -xf $package -C $outer
if ($LASTEXITCODE -ne 0) { throw 'Debian package extraction failed' }
$payload = Get-ChildItem -LiteralPath $outer -File -Filter 'data.tar*' | Select-Object -First 1
if (-not $payload) { throw 'Proma payload layout changed' }
$app = Join-Path $root 'app'
New-Item -ItemType Directory -Path $app -Force | Out-Null
& tar -xf $payload.FullName -C $app --include='*/resources/app.asar'
if ($LASTEXITCODE -ne 0) { throw 'Application resource extraction failed' }
$archive = Get-ChildItem -LiteralPath $app -Recurse -File -Filter app.asar | Select-Object -First 1
if (-not $archive) { throw 'Proma ASAR missing' }
$env:PROMA_TEST_ASAR = $archive.FullName
node --test proma-capability.test.cjs
if ($LASTEXITCODE -ne 0) { throw 'Official Proma capability verification failed' }
