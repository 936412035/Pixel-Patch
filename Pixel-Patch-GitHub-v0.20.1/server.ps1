param([int]$Port = 17836)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Net.Http
[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12

$AppRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Http = New-Object System.Net.Http.HttpClient
$Http.Timeout = [TimeSpan]::FromMinutes(12)
$Server = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$script:RestartRequested = $false

function Read-HttpRequest($Client) {
  $Stream = $Client.GetStream()
  $HeaderBytes = New-Object 'System.Collections.Generic.List[byte]'
  while ($true) {
    $Value = $Stream.ReadByte()
    if ($Value -lt 0) { throw "Client closed before sending HTTP headers" }
    $HeaderBytes.Add([byte]$Value)
    $Count = $HeaderBytes.Count
    if ($Count -gt 65536) { throw "HTTP headers are too large" }
    if ($Count -ge 4 -and $HeaderBytes[$Count-4] -eq 13 -and $HeaderBytes[$Count-3] -eq 10 -and $HeaderBytes[$Count-2] -eq 13 -and $HeaderBytes[$Count-1] -eq 10) { break }
  }
  $HeaderText = [System.Text.Encoding]::ASCII.GetString($HeaderBytes.ToArray())
  $Lines = $HeaderText -split "`r`n"
  $First = $Lines[0] -split " "
  if ($First.Count -lt 2) { throw "Invalid HTTP request line" }
  $Headers = @{}
  foreach ($Line in $Lines[1..($Lines.Count-1)]) {
    $Index = $Line.IndexOf(":")
    if ($Index -gt 0) { $Headers[$Line.Substring(0,$Index).Trim().ToLowerInvariant()] = $Line.Substring($Index+1).Trim() }
  }
  $ContentLength = 0
  if ($Headers.ContainsKey("content-length")) { $ContentLength = [int64]$Headers["content-length"] }
  if ($ContentLength -gt 62914560) { throw "The local proxy request exceeds 60 MB" }
  $Body = New-Object byte[] $ContentLength
  $Offset = 0
  while ($Offset -lt $ContentLength) {
    $Read = $Stream.Read($Body, $Offset, [int]($ContentLength - $Offset))
    if ($Read -le 0) { throw "Client closed before sending the complete HTTP body" }
    $Offset += $Read
  }
  return [pscustomobject]@{ Stream=$Stream; Method=$First[0].ToUpperInvariant(); Path=$First[1].Split("?")[0]; Headers=$Headers; Body=$Body }
}

function Write-BytesResponse($Request, [int]$Status, [string]$ContentType, [byte[]]$Bytes) {
  $Reasons = @{ 200="OK"; 204="No Content"; 400="Bad Request"; 403="Forbidden"; 404="Not Found"; 405="Method Not Allowed"; 409="Conflict"; 413="Payload Too Large"; 500="Internal Server Error"; 502="Bad Gateway" }
  $Reason = $Reasons[$Status]; if (-not $Reason) { $Reason = "Response" }
  $Head = "HTTP/1.1 $Status $Reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Bytes.Length)`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`nAccess-Control-Allow-Origin: *`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type, X-Pixel-Patch`r`nAccess-Control-Max-Age: 600`r`nConnection: close`r`n`r`n"
  $HeadBytes = [System.Text.Encoding]::ASCII.GetBytes($Head)
  $Request.Stream.Write($HeadBytes, 0, $HeadBytes.Length)
  $Request.Stream.Write($Bytes, 0, $Bytes.Length)
  $Request.Stream.Flush()
}

function Write-TextResponse($Request, [int]$Status, [string]$ContentType, [string]$Text) {
  Write-BytesResponse $Request $Status $ContentType ($Utf8.GetBytes($Text))
}

function Write-JsonResponse($Request, [int]$Status, $Value) {
  Write-TextResponse $Request $Status "application/json; charset=utf-8" ($Value | ConvertTo-Json -Depth 20 -Compress)
}

function Convert-DataUrl([string]$DataUrl) {
  if ($DataUrl -notmatch '^data:(?<mime>image/[a-zA-Z0-9.+-]+);base64,(?<data>.+)$') { throw "Invalid image data received by the local proxy" }
  return @{ Mime=$Matches.mime; Bytes=[Convert]::FromBase64String($Matches.data) }
}

function Test-PrivateAddress($Address) {
  if ([System.Net.IPAddress]::IsLoopback($Address)) { return $true }
  if ($Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
    $b = $Address.GetAddressBytes()
    if ($b[0] -eq 0 -or $b[0] -eq 10 -or $b[0] -eq 127 -or $b[0] -ge 224) { return $true }
    if ($b[0] -eq 169 -and $b[1] -eq 254) { return $true }
    if ($b[0] -eq 172 -and $b[1] -ge 16 -and $b[1] -le 31) { return $true }
    if ($b[0] -eq 192 -and $b[1] -eq 168) { return $true }
    if ($b[0] -eq 100 -and $b[1] -ge 64 -and $b[1] -le 127) { return $true }
  } elseif ($Address.IsIPv6LinkLocal -or $Address.IsIPv6SiteLocal -or $Address.IsIPv6Multicast) { return $true }
  return $false
}

function Get-SafeRemoteUri([string]$Url) {
  try { $Uri = [Uri]$Url } catch { throw "The endpoint or result URL is invalid" }
  if (-not $Uri.IsAbsoluteUri -or $Uri.Scheme -ne "https") { throw "The local proxy only permits remote HTTPS URLs" }
  if ($Uri.UserInfo -or $Uri.Host -eq "localhost" -or $Uri.Host.EndsWith(".local")) { throw "The local proxy blocks local and private network URLs" }
  try { $Addresses = [System.Net.Dns]::GetHostAddresses($Uri.DnsSafeHost) } catch { throw "Unable to resolve the remote API host" }
  if (-not $Addresses.Count -or ($Addresses | Where-Object { Test-PrivateAddress $_ })) { throw "The local proxy blocks local and private network URLs" }
  return $Uri
}

function Assert-ProviderEndpoint([string]$Provider, [Uri]$Uri) {
  $HostName = $Uri.DnsSafeHost.ToLowerInvariant()
  if ($Provider -eq "openai" -and $HostName -ne "api.openai.com") { throw "OpenAI mode only permits api.openai.com" }
  if ($Provider -eq "qwen" -and -not $HostName.EndsWith(".maas.aliyuncs.com")) { throw "Qwen mode only permits maas.aliyuncs.com endpoints" }
  if ($Provider -eq "minimax" -and $HostName -ne "api.minimaxi.com") { throw "MiniMax mode only permits api.minimaxi.com" }
}

function New-StringPart([string]$Value) { return New-Object System.Net.Http.StringContent($Value, [System.Text.Encoding]::UTF8) }

function Send-RemoteRequest([Uri]$Uri, [string]$ApiKey, $Content) {
  $Message = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $Uri)
  $Message.Headers.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", $ApiKey)
  $Message.Content = $Content
  try {
    $Response = $Http.SendAsync($Message).GetAwaiter().GetResult()
    $Text = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
    try { $Payload = $Text | ConvertFrom-Json } catch { $Payload = $null }
    if (-not $Response.IsSuccessStatusCode) {
      $ErrorMessage = $Payload.error.message
      if (-not $ErrorMessage) { $ErrorMessage = $Payload.message }
      if (-not $ErrorMessage) { $ErrorMessage = $Payload.msg }
      if (-not $ErrorMessage) { $ErrorMessage = "Remote API request failed (HTTP $([int]$Response.StatusCode))" }
      throw $ErrorMessage
    }
    return $Payload
  } finally { $Message.Dispose() }
}

function Get-RemoteImage([string]$Value) {
  if ($Value -match '^data:(?<mime>image/[a-zA-Z0-9.+-]+);base64,(?<data>.+)$') { return @{ Mime=$Matches.mime; Bytes=[Convert]::FromBase64String($Matches.data) } }
  $Uri = Get-SafeRemoteUri $Value
  $Response = $Http.GetAsync($Uri).GetAwaiter().GetResult()
  if (-not $Response.IsSuccessStatusCode) { throw "The generated image URL could not be downloaded" }
  $Mime = $Response.Content.Headers.ContentType.MediaType
  if (-not $Mime.StartsWith("image/")) { throw "The result URL did not return an image" }
  return @{ Mime=$Mime; Bytes=$Response.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult() }
}

function Invoke-OpenAiCompatible($Body, [Uri]$Endpoint) {
  $Target = Convert-DataUrl $Body.targetImage
  $Reference = Convert-DataUrl $Body.referenceImage
  $Multi = New-Object System.Net.Http.MultipartFormDataContent
  $Multi.Add((New-StringPart $Body.model), "model")
  $Multi.Add((New-StringPart $Body.prompt), "prompt")
  $Multi.Add((New-StringPart "high"), "quality")
  $Multi.Add((New-StringPart "png"), "output_format")
  $TargetPart = New-Object System.Net.Http.ByteArrayContent -ArgumentList (, $Target.Bytes)
  $TargetPart.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($Target.Mime)
  $Multi.Add($TargetPart, "image[]", "ai-target.png")
  $ReferencePart = New-Object System.Net.Http.ByteArrayContent -ArgumentList (, $Reference.Bytes)
  $ReferencePart.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($Reference.Mime)
  $Multi.Add($ReferencePart, "image[]", "original-color-reference.png")
  $Payload = Send-RemoteRequest $Endpoint $Body.apiKey $Multi
  if ($Payload.data -and $Payload.data.Count -gt 0 -and $Payload.data[0].b64_json) { return @{ Mime="image/png"; Bytes=[Convert]::FromBase64String($Payload.data[0].b64_json) } }
  if ($Payload.data -and $Payload.data.Count -gt 0 -and $Payload.data[0].url) { return Get-RemoteImage $Payload.data[0].url }
  throw "The compatible API response has no data[0].b64_json or data[0].url"
}

function Invoke-Qwen($Body, [Uri]$Endpoint) {
  $PayloadBody = @{ model=$Body.model; input=@{ messages=@(@{ role="user"; content=@(@{image=$Body.targetImage},@{image=$Body.referenceImage},@{text=$Body.prompt}) }) }; parameters=@{n=1;prompt_extend=$true;watermark=$false} }
  $Content = New-Object System.Net.Http.StringContent(($PayloadBody | ConvertTo-Json -Depth 15 -Compress), [System.Text.Encoding]::UTF8, "application/json")
  $Payload = Send-RemoteRequest $Endpoint $Body.apiKey $Content
  $Image = $Payload.output.choices[0].message.content | Where-Object { $_.image } | Select-Object -First 1
  if (-not $Image.image) { throw "The Qwen response did not contain an image" }
  return Get-RemoteImage $Image.image
}

function Invoke-MiniMax($Body, [Uri]$Endpoint) {
  [void](Get-SafeRemoteUri $Body.targetPublicUrl); [void](Get-SafeRemoteUri $Body.referencePublicUrl)
  $PayloadBody = @{ model=$Body.model; prompt=$Body.prompt; subject_reference=@(@{type="character";image_file=$Body.targetPublicUrl},@{type="character";image_file=$Body.referencePublicUrl}); aspect_ratio=$Body.aspectRatio; response_format="base64"; n=1; prompt_optimizer=$false; aigc_watermark=$false }
  $Content = New-Object System.Net.Http.StringContent(($PayloadBody | ConvertTo-Json -Depth 12 -Compress), [System.Text.Encoding]::UTF8, "application/json")
  $Payload = Send-RemoteRequest $Endpoint $Body.apiKey $Content
  if ($Payload.base_resp.status_code -and [int]$Payload.base_resp.status_code -ne 0) { throw $Payload.base_resp.status_msg }
  if ($Payload.data.image_base64 -and $Payload.data.image_base64.Count -gt 0) { return @{ Mime="image/jpeg"; Bytes=[Convert]::FromBase64String($Payload.data.image_base64[0]) } }
  if ($Payload.data.image_urls -and $Payload.data.image_urls.Count -gt 0) { return Get-RemoteImage $Payload.data.image_urls[0] }
  throw "The MiniMax response did not contain an image"
}

function Invoke-ColorCorrection($Request) {
  if ($Request.Headers["x-pixel-patch"] -ne "1") { throw "Invalid local proxy request" }
  $Body = $Utf8.GetString($Request.Body) | ConvertFrom-Json
  if (-not $Body.provider -or -not $Body.endpoint -or -not $Body.model -or -not $Body.apiKey -or -not $Body.prompt) { throw "Endpoint, model, API key, or prompt is empty" }
  $Endpoint = Get-SafeRemoteUri $Body.endpoint
  Assert-ProviderEndpoint $Body.provider $Endpoint
  if ($Body.provider -eq "qwen") { $Image = Invoke-Qwen $Body $Endpoint }
  elseif ($Body.provider -eq "minimax") { $Image = Invoke-MiniMax $Body $Endpoint }
  else { $Image = Invoke-OpenAiCompatible $Body $Endpoint }
  Write-JsonResponse $Request 200 @{imageBase64=[Convert]::ToBase64String($Image.Bytes);mimeType=$Image.Mime}
}

function Invoke-UpdateCheck($Request) {
  $Updater = Join-Path $AppRoot "updater.ps1"
  if (-not (Test-Path -LiteralPath $Updater -PathType Leaf)) { throw "本地更新组件缺失" }
  $Result = & $Updater -Mode Check -AppRoot $AppRoot
  Write-JsonResponse $Request 200 $Result
}

function Start-ProxyRestart {
  $Helper = Join-Path $AppRoot "restart-server.ps1"
  $ServerPath = Join-Path $AppRoot "server.ps1"
  if (-not (Test-Path -LiteralPath $Helper -PathType Leaf)) { throw "代理重启组件缺失" }
  $Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Helper`" -ServerPath `"$ServerPath`" -Port $Port"
  [void](Start-Process -FilePath "powershell.exe" -ArgumentList $Arguments -WindowStyle Hidden)
}

function Invoke-UpdateInstall($Request) {
  if ($Request.Headers["x-pixel-patch"] -ne "1") { throw "Invalid local update request" }
  $Body = $Utf8.GetString($Request.Body) | ConvertFrom-Json
  if (-not $Body.version -or ([string]$Body.version) -notmatch '^\d+\.\d+\.\d+$') { throw "请求安装的版本号无效" }
  $Updater = Join-Path $AppRoot "updater.ps1"
  if (-not (Test-Path -LiteralPath $Updater -PathType Leaf)) { throw "本地更新组件缺失" }
  $Result = & $Updater -Mode Install -AppRoot $AppRoot -RequestedVersion ([string]$Body.version)
  Start-ProxyRestart
  $script:RestartRequested = $true
  Write-JsonResponse $Request 200 $Result
}

function Serve-Static($Request) {
  $Files = @{ "/"=@{Name="index.html";Type="text/html; charset=utf-8"}; "/index.html"=@{Name="index.html";Type="text/html; charset=utf-8"}; "/styles.css"=@{Name="styles.css";Type="text/css; charset=utf-8"}; "/app.js"=@{Name="app.js";Type="application/javascript; charset=utf-8"} }
  if (-not $Files.ContainsKey($Request.Path)) { Write-JsonResponse $Request 404 @{error=@{message="Not found"}}; return }
  $Entry=$Files[$Request.Path]
  Write-BytesResponse $Request 200 $Entry.Type ([System.IO.File]::ReadAllBytes((Join-Path $AppRoot $Entry.Name)))
}

try {
  $Server.Start()
  $LastRequest=[DateTime]::UtcNow
  while (-not $script:RestartRequested) {
    $Pending=$Server.AcceptTcpClientAsync()
    while (-not $Pending.Wait(1000)) { if (([DateTime]::UtcNow-$LastRequest).TotalHours -ge 2) { return } }
    $Client=$Pending.Result; $LastRequest=[DateTime]::UtcNow; $Request=$null
    try {
      $Request=Read-HttpRequest $Client
      if ($Request.Method -eq "OPTIONS") { Write-BytesResponse $Request 204 "text/plain" (New-Object byte[] 0) }
      elseif ($Request.Method -eq "GET" -and $Request.Path -eq "/health") { Write-JsonResponse $Request 200 @{app="pixel-patch";proxy="ready"} }
      elseif ($Request.Method -eq "GET" -and $Request.Path -eq "/api/update/check") { Invoke-UpdateCheck $Request }
      elseif ($Request.Method -eq "POST" -and $Request.Path -eq "/api/update/install") { Invoke-UpdateInstall $Request }
      elseif ($Request.Method -eq "POST" -and $Request.Path -eq "/api/color-correct") { Invoke-ColorCorrection $Request }
      elseif ($Request.Method -eq "GET") { Serve-Static $Request }
      else { Write-JsonResponse $Request 405 @{error=@{message="Method not allowed"}} }
    } catch {
      if ($Request) { try { Write-JsonResponse $Request 502 @{error=@{message=$_.Exception.Message}} } catch {} }
    } finally { $Client.Close() }
  }
} finally {
  $Server.Stop(); $Http.Dispose()
}
