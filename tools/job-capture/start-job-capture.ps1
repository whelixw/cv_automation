$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pythonExe = Join-Path $projectRoot ".venv\Scripts\python.exe"
$serverScript = Join-Path $PSScriptRoot "server.py"

if (-not (Test-Path -LiteralPath $pythonExe -PathType Leaf)) {
    Write-Host "Error: The project virtual environment was not found at:" -ForegroundColor Red
    Write-Host "  $pythonExe"
    Read-Host "Press Enter to close"
    exit 1
}

$codexCommand = Get-Command codex.exe -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1
$codexExe = if ($codexCommand) { $codexCommand.Source } else { $null }

if (-not $codexExe) {
    $codexBin = Join-Path $env:LOCALAPPDATA "OpenAI\Codex\bin"
    if (Test-Path -LiteralPath $codexBin -PathType Container) {
        $codexExe = Get-ChildItem -LiteralPath $codexBin -Filter codex.exe -File -Recurse |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1 -ExpandProperty FullName
    }
}

if (-not $codexExe -or -not (Test-Path -LiteralPath $codexExe -PathType Leaf)) {
    Write-Host "Error: The Codex CLI executable could not be found." -ForegroundColor Red
    Write-Host "Expected it under: $env:LOCALAPPDATA\OpenAI\Codex\bin"
    Write-Host "Open or reinstall the Codex desktop app, then try again."
    Read-Host "Press Enter to close"
    exit 1
}

$env:JOB_CAPTURE_CODEX_EXE = $codexExe
Write-Host "Using Codex CLI: $codexExe" -ForegroundColor Green
Write-Host "Starting RenderCV Job Capture..."
Write-Host "Press Ctrl+C to stop the server."
Write-Host ""

Push-Location $projectRoot
try {
    & $pythonExe $serverScript @args
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
