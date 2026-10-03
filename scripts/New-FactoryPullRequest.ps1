# Requires PowerShell 7. The private key stays outside the repository; tokens stay in memory.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9]+$')][string]$AppId,
    [Parameter(Mandatory)][ValidatePattern('^[0-9]+$')][string]$InstallationId,
    [Parameter(Mandatory)][string]$PrivateKeyPath,
    [string]$Repository = 'AJHMH/software-factory',
    [string]$Head,
    [string]$Title,
    [string]$BodyFile,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
try {
    if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required.' }
    if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Invalid repository.' }
    if (-not $VerifyOnly -and ($Head -notmatch '^feat/[A-Za-z0-9._/-]+$' -or [string]::IsNullOrWhiteSpace($Title) -or -not $BodyFile)) { throw 'A feature branch, title, and body file are required.' }
    $repositoryParts = $Repository.Split('/')
    $keyFile = (Resolve-Path -LiteralPath $PrivateKeyPath).Path
    $keyText = [IO.File]::ReadAllText($keyFile)
    $rsa = [Security.Cryptography.RSA]::Create()
    try {
        $rsa.ImportFromPem($keyText)
        $keyText = $null
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $jwtHeader = @{ alg = 'RS256'; typ = 'JWT' } | ConvertTo-Json -Compress
        $jwtClaims = @{ iat = $now - 60; exp = $now + 540; iss = $AppId } | ConvertTo-Json -Compress
        $encode = { param([byte[]]$Bytes) [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+','-').Replace('/','_') }
        $unsigned = (& $encode ([Text.Encoding]::UTF8.GetBytes($jwtHeader))) + '.' + (& $encode ([Text.Encoding]::UTF8.GetBytes($jwtClaims)))
        $signature = $rsa.SignData([Text.Encoding]::UTF8.GetBytes($unsigned), [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $jwt = $unsigned + '.' + (& $encode $signature)
    } finally { $rsa.Dispose() }
    $appHeaders = @{ Authorization = "Bearer $jwt"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2026-03-10' }
    $app = Invoke-RestMethod -Uri 'https://api.github.com/app' -Headers $appHeaders -TimeoutSec 30 -MaximumRedirection 0
    $tokenRequest = @{ repositories = @($repositoryParts[1]); permissions = @{ contents = 'read'; pull_requests = 'write' } } | ConvertTo-Json -Depth 4 -Compress
    $installation = Invoke-RestMethod -Method Post -Uri "https://api.github.com/app/installations/$InstallationId/access_tokens" -Headers $appHeaders -ContentType 'application/json' -Body $tokenRequest -TimeoutSec 30 -MaximumRedirection 0
    $installationHeaders = @{ Authorization = "Bearer $($installation.token)"; Accept = 'application/vnd.github+json'; 'X-GitHub-Api-Version' = '2026-03-10' }
    $repositoryInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository" -Headers $installationHeaders -TimeoutSec 30 -MaximumRedirection 0
    if ($repositoryInfo.full_name -ine $Repository -or $installation.permissions.pull_requests -ne 'write' -or $installation.permissions.contents -ne 'read') { throw 'Unexpected installation scope.' }
    if ($VerifyOnly) {
        @{ appId = $app.id; appSlug = $app.slug; actor = "$($app.slug)[bot]"; repository = $repositoryInfo.full_name; contents = 'read'; pullRequests = 'write' } | ConvertTo-Json -Compress
    } else {
        $bodyText = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $BodyFile).Path)
        $request = @{ title = $Title; head = $Head; base = 'main'; body = $bodyText; maintainer_can_modify = $false } | ConvertTo-Json -Compress
        $pr = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$Repository/pulls" -Headers $installationHeaders -ContentType 'application/json' -Body $request -TimeoutSec 30 -MaximumRedirection 0
        @{ url = $pr.html_url; number = $pr.number; author = $pr.user.login; head = $pr.head.sha } | ConvertTo-Json -Compress
    }
} catch {
    Write-Error 'Factory App authentication or PR creation failed. Verify the App registration, installation, key path, repository permissions, branch, and existing PR state. Credentials have not been printed.'
    exit 1
} finally {
    $keyText = $null; $jwt = $null; $appHeaders = $null; $installationHeaders = $null; $installation = $null
}
