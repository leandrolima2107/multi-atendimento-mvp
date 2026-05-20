param(
  [string]$DatabaseUrl = $env:DATABASE_URL,
  [string]$DirectUrl = $env:DIRECT_URL,
  [string]$EnvFile = ".env.supabase.local",
  [switch]$Seed,
  [switch]$AllowDevSeed,
  [switch]$StatusOnly
)

$ErrorActionPreference = "Stop"

function Read-DotEnvValue {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  $line = Get-Content -LiteralPath $Path |
    Where-Object { $_ -match "^\s*$Name\s*=" } |
    Select-Object -First 1

  if (-not $line) {
    return $null
  }

  return ($line -replace "^\s*$Name\s*=\s*", "").Trim().Trim('"').Trim("'")
}

if (-not $DatabaseUrl) {
  $DatabaseUrl = Read-DotEnvValue -Path $EnvFile -Name "DATABASE_URL"
}

if (-not $DirectUrl) {
  $DirectUrl = Read-DotEnvValue -Path $EnvFile -Name "DIRECT_URL"
}

if (-not $DatabaseUrl) {
  throw "DATABASE_URL was not provided. Copy .env.supabase.example to .env.supabase.local or pass -DatabaseUrl."
}

if ($DatabaseUrl -match "\[YOUR-PASSWORD\]") {
  throw "DATABASE_URL still contains [YOUR-PASSWORD]. Replace it with the real password before migrating."
}

if ($DirectUrl -and $DirectUrl -match "\[YOUR-PASSWORD\]") {
  throw "DIRECT_URL still contains [YOUR-PASSWORD]. Replace it with the real password before migrating."
}

$uri = [Uri]$DatabaseUrl
$hostName = $uri.Host
$port = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }

if ($Seed -and -not $AllowDevSeed -and $hostName -notin @("localhost", "127.0.0.1")) {
  throw "Seed is blocked for remote databases. Use -AllowDevSeed only for temporary staging, never production."
}

$tcp = Test-NetConnection -ComputerName $hostName -Port $port -WarningAction SilentlyContinue
if (-not $tcp.TcpTestSucceeded) {
  throw "Could not open TCP connection to ${hostName}:${port}. Check firewall, allowlist, or database endpoint."
}

$previousDatabaseUrl = $env:DATABASE_URL
$previousDirectUrl = $env:DIRECT_URL
try {
  $env:DATABASE_URL = $DatabaseUrl
  $env:DIRECT_URL = if ($DirectUrl) { $DirectUrl } else { $DatabaseUrl }

  npm run db:generate

  if ($StatusOnly) {
    npx prisma migrate status --schema packages/db/prisma/schema.prisma
    return
  }

  npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

  if ($Seed) {
    npm run db:seed
  }

  npx prisma migrate status --schema packages/db/prisma/schema.prisma
} finally {
  $env:DATABASE_URL = $previousDatabaseUrl
  $env:DIRECT_URL = $previousDirectUrl
}
