param([string]$InstallRoot, [string]$Workspace, [string]$PythonExe, [switch]$NoStart)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
try {
    if (-not $InstallRoot) { $InstallRoot = Join-Path $env:LOCALAPPDATA "RenderCVJobCapture" }
    $InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
    if (-not $Workspace) {
        $picker = New-Object System.Windows.Forms.FolderBrowserDialog
        $picker.Description = "Choose a private folder for your Job Capture workspace. Existing profile files will be preserved."
        if ($picker.ShowDialog() -ne "OK") { exit 0 }
        $Workspace = $picker.SelectedPath
    }
    $Workspace = [System.IO.Path]::GetFullPath($Workspace)
    $running = $null
    try { $running = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2 } catch { $running = $null }
    if ($running.ok) { throw "Stop the running companion from the extension's Companion connection section before installing or updating." }
    if ($Workspace -eq $InstallRoot -or $Workspace.StartsWith($InstallRoot.TrimEnd('\') + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw "Choose a workspace outside the program installation folder so uninstall cannot remove private documents." }
    if (-not $PythonExe) {
        $candidates = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Programs\Python\*\python.exe") -File -ErrorAction SilentlyContinue
        foreach ($candidate in ($candidates | Sort-Object FullName -Descending)) {
            & $candidate.FullName -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)"
            if ($LASTEXITCODE -eq 0) { $PythonExe = $candidate.FullName; break }
        }
    }
    if (-not $PythonExe -or -not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
        throw "This developer installer needs Python 3.12 or newer installed for your user account. Install Python, then run this installer again."
    }
    & $PythonExe -c "import sys; sys.exit(0 if sys.version_info >= (3,12) else 1)"
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 or newer is required." }
    $manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot "release-manifest.json") -Raw | ConvertFrom-Json
    foreach ($entry in $manifest.files.PSObject.Properties) {
        $source = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $entry.Name))
        $prefix = [System.IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\') + '\'
        if (-not $source.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Invalid package path." }
        if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw "The downloaded package is incomplete or changed." }
    }
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    $release = Join-Path $InstallRoot ("releases\" + $manifest.version)
    if (Test-Path -LiteralPath $release) { throw "This release is already installed. Keep it running or install a newer release; no files were replaced." }
    New-Item -ItemType Directory -Path $release -Force | Out-Null
    foreach ($name in @("companion", "references", "extension")) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $release -Recurse
    }
    $venv = Join-Path $release "venv"
    & $PythonExe -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw "Could not create the private Python environment." }
    $python = Join-Path $venv "Scripts\python.exe"
    $log = Join-Path $release "installation.log"
    & $python -m pip install --disable-pip-version-check -r (Join-Path $release "companion\requirements.txt") *> $log
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed. See $log. The previous release and workspace were preserved." }
    & $python (Join-Path $release "companion\manage.py") initialize --workspace $Workspace --sources (Join-Path $release "references")
    if ($LASTEXITCODE -ne 0) { throw "Workspace setup failed. Existing files were not overwritten." }
    $configPath = Join-Path $InstallRoot "installation.json"
    $previous = if (Test-Path -LiteralPath $configPath) { (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).release } else { $null }
    @{ release = $release; previous = $previous; workspace = $Workspace } | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "Uninstall.ps1") -Destination (Join-Path $InstallRoot "Uninstall.ps1")
    $extension = Join-Path $InstallRoot "extension"
    New-Item -ItemType Directory -Path $extension -Force | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $release "extension") -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $extension -Force }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Start Job Capture.lnk"))
    $shortcut.TargetPath = Join-Path $venv "Scripts\pythonw.exe"
    $shortcut.Arguments = '"' + (Join-Path $release "companion\server.py") + '" --workspace "' + $Workspace + '"'
    $shortcut.WorkingDirectory = $release
    $shortcut.Save()
    if (-not $NoStart) {
        Start-Process -FilePath $shortcut.TargetPath -ArgumentList $shortcut.Arguments -WindowStyle Hidden
        Start-Process -FilePath "explorer.exe" -ArgumentList ('"' + $extension + '"') -WindowStyle Hidden
    }
    [System.Windows.Forms.MessageBox]::Show("Installed. Replace the starter profile with verified information in $Workspace\cv-private. Start Job Capture from the desktop shortcut. For this developer release, load the extension folder through chrome://extensions, then connect the companion. Close the previous companion before starting an updated release.", "Job Capture") | Out-Null
} catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, "Job Capture setup") | Out-Null
    exit 1
}
