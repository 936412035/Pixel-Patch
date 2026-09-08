param(
  [ValidateSet("Check", "Install")][string]$Mode = "Check",
  [Parameter(Mandatory=$true)][string]$AppRoot,
  [string]$RequestedVersion = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

function Read-Manifest([string]$Root) {
  $Path = Join-Path $Root "version.json"
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "缺少 version.json，无法安全检查更新" }
  $Manifest = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($Manifest.repository -ne "936412035/Pixel-Patch") { throw "更新仓库配置不正确" }
  if ($Manifest.version -notmatch '^\d+\.\d+\.\d+$') { throw "本地版本号格式不正确" }
  return $Manifest
}

function Normalize-Version([string]$Value) {
  if ($Value -notmatch '^v?(\d+\.\d+\.\d+)$') { throw "GitHub Release 标签必须采用类似 v0.20.2 的格式" }
  return $Matches[1]
}

function Compare-Version([string]$Left, [string]$Right) {
  return ([version]$Left).CompareTo([version]$Right)
}

function New-GitHubRequest([string]$Url) {
  $Uri = [Uri]$Url
  if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -ne "https") { throw "GitHub 更新地址必须使用 HTTPS" }
  $Message = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $Uri)
  [void]$Message.Headers.TryAddWithoutValidation("User-Agent", "Pixel-Patch-Updater")
  [void]$Message.Headers.TryAddWithoutValidation("Accept", "*/*")
  return $Message
}

function Get-RemoteManifest($Http, $Manifest) {
  $Sources = @($Manifest.updateManifests)
  if (-not $Sources.Count) { $Sources = @("https://raw.githubusercontent.com/$($Manifest.repository)/main/version.json") }
  $Errors = New-Object 'System.Collections.Generic.List[string]'
  foreach ($Source in $Sources) {
    $Response = $null
    $Message = New-GitHubRequest ([string]$Source)
    try {
      $Response = $Http.SendAsync($Message).GetAwaiter().GetResult()
      $Text = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      if (-not $Response.IsSuccessStatusCode) { throw "HTTP $([int]$Response.StatusCode)" }
      $Remote = $Text | ConvertFrom-Json
      if ($Remote.repository -ne $Manifest.repository) { throw "仓库标识不匹配" }
      [void](Normalize-Version ([string]$Remote.version))
      if (-not $Remote.releaseAsset) { throw "缺少 releaseAsset" }
      return [pscustomobject]@{ manifest=$Remote; source=[string]$Source }
    } catch {
      $Errors.Add("$Source：$($_.Exception.Message)")
    } finally {
      $Message.Dispose()
      if ($Response) { $Response.Dispose() }
    }
  }
  throw "无法读取静态版本清单。" + ($Errors -join "；")
}

function Get-ReleaseInfo($Http, $Manifest) {
  $RemoteResult = Get-RemoteManifest $Http $Manifest
  $Remote = $RemoteResult.manifest
  $Latest = Normalize-Version ([string]$Remote.version)
  $AssetName = ([string]$Remote.releaseAsset) -replace '\{version\}', $Latest
  $EncodedAsset = [Uri]::EscapeDataString($AssetName)
  $ReleaseRoot = "https://github.com/$($Manifest.repository)/releases/download/v$Latest"
  $AssetUrl = "$ReleaseRoot/$EncodedAsset"
  $ChecksumUrl = "$AssetUrl.sha256"
  $HasUpdate = (Compare-Version $Latest ([string]$Manifest.version)) -gt 0
  $Notes = [string]$Remote.releaseNotes
  if ($Notes.Length -gt 6000) { $Notes = $Notes.Substring(0, 6000) + "`n…" }
  return [pscustomobject]@{
    currentVersion = $Manifest.version; latestVersion = $Latest; updateAvailable = $HasUpdate
    installable = $HasUpdate; assetAvailable = $true; checksumAvailable = $true; expectedAssetName = $AssetName
    releaseNotes = $Notes; releaseUrl = "https://github.com/$($Manifest.repository)/releases/tag/v$Latest"
    publishedAt = $null; assetSize = 0; versionSource = $RemoteResult.source
    asset = [pscustomobject]@{ name=$AssetName; size=0; browser_download_url=$AssetUrl }
    checksumAsset = [pscustomobject]@{ name="$AssetName.sha256"; browser_download_url=$ChecksumUrl }
    checksum = $null
  }
}

function Get-RemoteText($Http, [string]$Url) {
  $Message = New-GitHubRequest $Url
  try {
    $Response = $Http.SendAsync($Message).GetAwaiter().GetResult()
    if (-not $Response.IsSuccessStatusCode) { throw "无法下载更新校验文件（HTTP $([int]$Response.StatusCode)）" }
    return $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  } finally {
    $Message.Dispose()
    if ($Response) { $Response.Dispose() }
  }
}

function Save-RemoteFile($Http, [string]$Url, [string]$Destination, [int64]$MaximumBytes) {
  $Message = New-GitHubRequest $Url
  try {
    $Response = $Http.SendAsync($Message, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    if (-not $Response.IsSuccessStatusCode) { throw "无法下载更新包（HTTP $([int]$Response.StatusCode)）" }
    $Length = $Response.Content.Headers.ContentLength
    if ($Length -and $Length -gt $MaximumBytes) { throw "更新包超过允许的大小" }
    $Input = $Response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $Output = New-Object System.IO.FileStream($Destination, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $Buffer = New-Object byte[] 1048576
      $Total = 0L
      while (($Read = $Input.Read($Buffer, 0, $Buffer.Length)) -gt 0) {
        $Total += $Read
        if ($Total -gt $MaximumBytes) { throw "更新包超过允许的大小" }
        $Output.Write($Buffer, 0, $Read)
      }
    } finally { $Output.Dispose(); $Input.Dispose() }
  } finally {
    $Message.Dispose()
    if ($Response) { $Response.Dispose() }
  }
}

function Expand-SafeZip([string]$ZipPath, [string]$Destination) {
  [void](New-Item -ItemType Directory -Path $Destination -Force)
  $Root = [System.IO.Path]::GetFullPath($Destination).TrimEnd('\') + '\'
  $Archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    if ($Archive.Entries.Count -gt 2000) { throw "更新包包含过多文件" }
    $Total = 0L
    foreach ($Entry in $Archive.Entries) {
      $Total += [int64]$Entry.Length
      if ($Total -gt 629145600) { throw "更新包解压后超过允许的大小" }
      $Target = [System.IO.Path]::GetFullPath((Join-Path $Destination $Entry.FullName))
      if (-not $Target.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) { throw "更新包包含不安全的文件路径" }
      if ([string]::IsNullOrEmpty($Entry.Name)) { [void](New-Item -ItemType Directory -Path $Target -Force); continue }
      [void](New-Item -ItemType Directory -Path (Split-Path -Parent $Target) -Force)
      $Input = $Entry.Open()
      $Output = New-Object System.IO.FileStream($Target, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
      try { $Input.CopyTo($Output) } finally { $Output.Dispose(); $Input.Dispose() }
    }
  } finally { $Archive.Dispose() }
}

function Resolve-ManagedPath([string]$Root, [string]$Relative) {
  if ([string]::IsNullOrWhiteSpace($Relative) -or [System.IO.Path]::IsPathRooted($Relative)) { throw "更新清单包含无效路径" }
  $Base = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $Path = [System.IO.Path]::GetFullPath((Join-Path $Root $Relative))
  if (-not $Path.StartsWith($Base, [System.StringComparison]::OrdinalIgnoreCase)) { throw "更新清单包含越界路径" }
  return $Path
}

function Install-Release($Http, $Manifest, $Info) {
  if (-not $Info.updateAvailable) { throw "当前已经是最新版本" }
  if ($RequestedVersion -and $RequestedVersion -ne $Info.latestVersion) { throw "最新版本已发生变化，请重新检查后再安装" }
  if (-not $Info.asset) { throw "Release 中缺少 $($Info.expectedAssetName)" }
  if (-not $Info.checksumAvailable) { throw "Release 中缺少 SHA-256 校验信息，已拒绝安装" }
  if ([int64]$Info.asset.size -gt 262144000) { throw "更新包超过 250 MB，已拒绝安装" }

  $TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("pixel-patch-update-" + [guid]::NewGuid().ToString("N"))
  $ZipPath = Join-Path $TempRoot $Info.expectedAssetName
  $ExtractRoot = Join-Path $TempRoot "extracted"
  [void](New-Item -ItemType Directory -Path $TempRoot)
  try {
    Save-RemoteFile $Http ([string]$Info.asset.browser_download_url) $ZipPath 262144000
    $ExpectedHash = $Info.checksum
    if (-not $ExpectedHash) {
      $ChecksumText = Get-RemoteText $Http ([string]$Info.checksumAsset.browser_download_url)
      $Pattern = '(?im)^\s*([a-f0-9]{64})\s+\*?' + [regex]::Escape($Info.expectedAssetName) + '\s*$'
      $Match = [regex]::Match($ChecksumText, $Pattern)
      if (-not $Match.Success -and $Info.checksumAsset.name -eq "$($Info.expectedAssetName).sha256") { $Match = [regex]::Match($ChecksumText, '(?i)([a-f0-9]{64})') }
      if (-not $Match.Success) { throw "SHA-256 校验文件中找不到当前更新包" }
      $ExpectedHash = $Match.Groups[1].Value.ToLowerInvariant()
    }
    $ActualHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($ActualHash -ne $ExpectedHash) { throw "更新包 SHA-256 校验失败，文件可能已损坏" }

    Expand-SafeZip $ZipPath $ExtractRoot
    $Candidates = @(Get-ChildItem -LiteralPath $ExtractRoot -Filter "version.json" -File -Recurse)
    if ($Candidates.Count -ne 1) { throw "更新包必须包含且只能包含一个 version.json" }
    $PackageRoot = Split-Path -Parent $Candidates[0].FullName
    $NewManifest = Read-Manifest $PackageRoot
    if ($NewManifest.version -ne $Info.latestVersion) { throw "更新包内版本号与 GitHub Release 不一致" }
    if (-not $NewManifest.files -or -not $NewManifest.launcher) { throw "更新包清单不完整" }
    if (-not (@($NewManifest.files) -contains [string]$NewManifest.launcher)) { throw "更新清单没有包含启动脚本" }

    $NewFiles = @($NewManifest.files | Select-Object -Unique)
    $OldFiles = @($Manifest.files | Select-Object -Unique)
    foreach ($Relative in $NewFiles) {
      $Source = Resolve-ManagedPath $PackageRoot ([string]$Relative)
      if (-not (Test-Path -LiteralPath $Source -PathType Leaf)) { throw "更新包缺少文件：$Relative" }
    }

    $BackupRoot = Join-Path $AppRoot (".updates\backup-v$($Manifest.version)-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    [void](New-Item -ItemType Directory -Path $BackupRoot -Force)
    $AllFiles = @($OldFiles + $NewFiles | Select-Object -Unique)
    foreach ($Relative in $AllFiles) {
      $Current = Resolve-ManagedPath $AppRoot ([string]$Relative)
      if (Test-Path -LiteralPath $Current -PathType Leaf) {
        $Backup = Resolve-ManagedPath $BackupRoot ([string]$Relative)
        [void](New-Item -ItemType Directory -Path (Split-Path -Parent $Backup) -Force)
        Copy-Item -LiteralPath $Current -Destination $Backup -Force
      }
    }

    try {
      foreach ($Relative in $OldFiles) {
        if ($NewFiles -notcontains $Relative) {
          $Obsolete = Resolve-ManagedPath $AppRoot ([string]$Relative)
          if (Test-Path -LiteralPath $Obsolete -PathType Leaf) { Remove-Item -LiteralPath $Obsolete -Force }
        }
      }
      foreach ($Relative in $NewFiles) {
        $Source = Resolve-ManagedPath $PackageRoot ([string]$Relative)
        $Destination = Resolve-ManagedPath $AppRoot ([string]$Relative)
        [void](New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force)
        Copy-Item -LiteralPath $Source -Destination $Destination -Force
      }
    } catch {
      foreach ($Relative in $AllFiles) {
        $Destination = Resolve-ManagedPath $AppRoot ([string]$Relative)
        $Backup = Resolve-ManagedPath $BackupRoot ([string]$Relative)
        if (Test-Path -LiteralPath $Destination -PathType Leaf) { Remove-Item -LiteralPath $Destination -Force }
        if (Test-Path -LiteralPath $Backup -PathType Leaf) {
          [void](New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force)
          Copy-Item -LiteralPath $Backup -Destination $Destination -Force
        }
      }
      throw
    }
    return [pscustomobject]@{ installedVersion=$Info.latestVersion; launcher=[string]$NewManifest.launcher; backupPath=$BackupRoot; restartRequired=$true }
  } finally {
    if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force }
  }
}

$Manifest = Read-Manifest $AppRoot
$Http = New-Object System.Net.Http.HttpClient
$Http.Timeout = [TimeSpan]::FromMinutes(10)
try {
  $Info = Get-ReleaseInfo $Http $Manifest
  if ($Mode -eq "Check") {
    return [pscustomobject]@{
      currentVersion=$Info.currentVersion; latestVersion=$Info.latestVersion; updateAvailable=$Info.updateAvailable
      installable=$Info.installable; assetAvailable=$Info.assetAvailable; checksumAvailable=$Info.checksumAvailable
      expectedAssetName=$Info.expectedAssetName; releaseNotes=$Info.releaseNotes; releaseUrl=$Info.releaseUrl
      publishedAt=$Info.publishedAt; assetSize=$Info.assetSize
    }
  }
  return Install-Release $Http $Manifest $Info
} finally { $Http.Dispose() }
