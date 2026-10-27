$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
$installPath = [System.IO.Path]::GetFullPath($PSScriptRoot)
$expected = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "RenderCVJobCapture"))
if ($installPath -ne $expected) { throw "Automatic uninstall only supports the default installation folder. Custom installations must be removed manually." }
$configPath = Join-Path $installPath "installation.json"
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "No installation record found." }
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$workspace = [System.IO.Path]::GetFullPath($config.workspace)
if ($workspace.StartsWith($installPath, [System.StringComparison]::OrdinalIgnoreCase)) { throw "Workspace is inside the program folder. Move it to a private backup before uninstalling." }
if (([System.Windows.Forms.MessageBox]::Show("Close the companion first. Remove program files? Your private workspace will remain at $workspace.", "Uninstall Job Capture", "YesNo")) -ne "Yes") { exit 0 }
$releases = [System.IO.Path]::GetFullPath((Join-Path $installPath "releases"))
if (-not $releases.StartsWith($expected + '\', [System.StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe uninstall target." }
foreach ($target in @($installPath, $releases)) {
    if ((Get-Item -LiteralPath $target -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw "Uninstall refuses linked program directories." }
}
if (Get-ChildItem -LiteralPath $releases -Recurse -Force | Where-Object { $_.Attributes -band [System.IO.FileAttributes]::ReparsePoint } | Select-Object -First 1) { throw "Uninstall found linked files. Remove this installation manually after preserving your workspace." }
Remove-Item -LiteralPath $releases -Recurse -Force
$shortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) "Start Job Capture.lnk"
if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut }
[System.Windows.Forms.MessageBox]::Show("Program releases removed. Your private documents and the installation record were retained. Remove the Chrome extension separately.", "Job Capture") | Out-Null
