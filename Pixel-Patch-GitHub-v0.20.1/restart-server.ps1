param(
  [Parameter(Mandatory=$true)][string]$ServerPath,
  [Parameter(Mandatory=$true)][int]$Port
)

$ErrorActionPreference = "SilentlyContinue"
Start-Sleep -Milliseconds 1400
& powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $ServerPath -Port $Port
