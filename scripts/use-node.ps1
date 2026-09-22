$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$taskVersion = '24.21.0'
$taskArchiveName = "node-v$taskVersion-win-x64.zip"
$taskTools = Join-Path $taskRoot '.tools'
$taskRuntime = Join-Path $taskTools "node-v$taskVersion-win-x64"
if (-not (Test-Path (Join-Path $taskRuntime 'node.exe'))) {
    New-Item -ItemType Directory -Force -Path $taskTools | Out-Null
    $taskArchive = Join-Path $taskTools $taskArchiveName
    $taskBaseUrl = "https://nodejs.org/dist/v$taskVersion"
    Invoke-WebRequest -Uri "$taskBaseUrl/$taskArchiveName" -OutFile $taskArchive
    $taskChecksums = (Invoke-WebRequest -Uri "$taskBaseUrl/SHASUMS256.txt").Content
    $taskChecksumLine = ($taskChecksums -split "`n") | Where-Object { $_.Trim().EndsWith(" $taskArchiveName") }
    if (@($taskChecksumLine).Count -ne 1) { throw 'No se encontro checksum unico del runtime oficial.' }
    $taskExpected = ($taskChecksumLine.Trim() -split '\s+')[0]
    $taskActual = (Get-FileHash -LiteralPath $taskArchive -Algorithm SHA256).Hash
    if ($taskActual -ne $taskExpected) { throw 'Checksum del runtime no coincide. No se extraera el archivo.' }
    Expand-Archive -LiteralPath $taskArchive -DestinationPath $taskTools -Force
}
$env:Path = "$taskRuntime;$env:Path"
if ((& (Join-Path $taskRuntime 'node.exe') --version) -ne "v$taskVersion") { throw 'Runtime local inesperado.' }
Write-Host "Node $taskVersion activado solo en esta sesion. npm $(& (Join-Path $taskRuntime 'npm.cmd') --version)"
