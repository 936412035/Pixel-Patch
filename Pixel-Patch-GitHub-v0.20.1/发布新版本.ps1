param(
  [Parameter(Mandatory=$true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ManifestPath = Join-Path $Root "version.json"
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$OldVersion = [string]$Manifest.version
if ($Version -eq $OldVersion) { throw "版本号仍是 $Version，请填写新的版本号" }
if (([version]$Version).CompareTo([version]$OldVersion) -le 0) { throw "新版本号必须高于 $OldVersion" }

$OldLauncher = [string]$Manifest.launcher
$NewLauncher = "启动-区域换图工具-v$Version.cmd"
$OldLauncherPath = Join-Path $Root $OldLauncher
$NewLauncherPath = Join-Path $Root $NewLauncher
if (-not (Test-Path -LiteralPath $OldLauncherPath -PathType Leaf)) { throw "找不到当前启动脚本：$OldLauncher" }
if (Test-Path -LiteralPath $NewLauncherPath) { throw "目标启动脚本已存在：$NewLauncher" }

$Utf8 = New-Object System.Text.UTF8Encoding($false)
foreach ($Name in @("index.html", "app.js", "使用说明.txt", "README.md")) {
  $Path = Join-Path $Root $Name
  $Text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  $Text = $Text.Replace("v$OldVersion", "v$Version").Replace("`"$OldVersion`"", "`"$Version`"").Replace("-Version $OldVersion", "-Version $Version")
  [System.IO.File]::WriteAllText($Path, $Text, $Utf8)
}

Move-Item -LiteralPath $OldLauncherPath -Destination $NewLauncherPath
$Manifest.version = $Version
$Manifest.launcher = $NewLauncher
$Manifest.files = @($Manifest.files | ForEach-Object { if ($_ -eq $OldLauncher) { $NewLauncher } else { $_ } })
[System.IO.File]::WriteAllText($ManifestPath, ($Manifest | ConvertTo-Json -Depth 8) + "`n", $Utf8)

Write-Host "已把项目版本从 v$OldVersion 更新为 v$Version。" -ForegroundColor Green
Write-Host "检查修改后执行："
Write-Host "  git add ."
Write-Host "  git commit -m `"Release v$Version`""
Write-Host "  git tag v$Version"
Write-Host "  git push origin HEAD --tags"
