$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$envFile = Join-Path $rootDir ".env"
$envExample = Join-Path $rootDir ".env.example"
$tmpDir = Join-Path $rootDir ".tmp"
$prismaBin = Join-Path $rootDir "node_modules\.bin\prisma.cmd"
$script:UseCorepackPnpm = $false

function Write-Step {
  param([string] $Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Warn {
  param([string] $Message)
  Write-Host "Warning: $Message" -ForegroundColor Yellow
}

function Test-CommandExists {
  param([string] $Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-Pnpm {
  if ($script:UseCorepackPnpm) {
    corepack pnpm @args
  } else {
    pnpm @args
  }
}

Set-Location $rootDir

if (-not (Test-Path $tmpDir)) {
  New-Item -ItemType Directory -Path $tmpDir | Out-Null
}

$env:TEMP = $tmpDir
$env:TMP = $tmpDir

Write-Step "Football Team Stats startup"

if (-not (Test-CommandExists "node")) {
  throw "Node.js is not installed or not available in PATH."
}

if (-not (Test-CommandExists "pnpm")) {
  if (Test-CommandExists "corepack") {
    Write-Step "pnpm not found, using Corepack pnpm"
    corepack prepare pnpm@9.12.3 --activate
    $script:UseCorepackPnpm = $true
  } else {
    throw "pnpm is not installed. Install pnpm or enable Corepack first."
  }
}

if (-not $script:UseCorepackPnpm -and -not (Test-CommandExists "pnpm")) {
  throw "pnpm is still not available after Corepack setup."
}

if (-not (Test-Path $envFile)) {
  if (Test-Path $envExample) {
    Write-Step "Creating .env from .env.example"
    Copy-Item -LiteralPath $envExample -Destination $envFile
    Write-Warn "Please edit .env if your PostgreSQL URL or DeepSeek API key is different."
  } else {
    Write-Warn ".env.example was not found. Skipping .env creation."
  }
}

if (-not (Test-Path (Join-Path $rootDir "node_modules\.modules.yaml"))) {
  Write-Step "Installing dependencies"
  Invoke-Pnpm install --frozen-lockfile --reporter append-only --child-concurrency=1
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "pnpm install failed. Retrying with a clean dependency rebuild."
    $env:CI = "true"
    Invoke-Pnpm install --frozen-lockfile --force --reporter append-only --child-concurrency=1
    if ($LASTEXITCODE -ne 0) {
      throw "pnpm install failed."
    }
  }
}

Write-Step "Generating Prisma Client"
Invoke-Pnpm prisma:generate
if ($LASTEXITCODE -ne 0) {
  throw "Prisma Client generation failed."
}

if ($env:START_SKIP_MIGRATE -ne "1") {
  Write-Step "Applying Prisma migrations"
  if (-not (Test-Path $prismaBin)) {
    throw "Prisma CLI was not found in node_modules. Run pnpm install first."
  }

  & $prismaBin migrate deploy
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "Database migration failed."
    Write-Warn "Check .env DATABASE_URL. The default postgres:postgres password may not match your local PostgreSQL password."
    Write-Warn "If the database does not exist, create it first: createdb -U postgres football_team"
    if ($env:START_ALLOW_DB_FAILURE -ne "1") {
      throw "Database is not ready. Fix DATABASE_URL or set START_ALLOW_DB_FAILURE=1 to start the UI anyway."
    }
    Write-Warn "START_ALLOW_DB_FAILURE=1, continuing without a verified database."
  }
} else {
  Write-Warn "START_SKIP_MIGRATE=1, skipping database migration."
}

$hostName = if ($env:START_HOST) { $env:START_HOST } else { "127.0.0.1" }
$port = if ($env:START_PORT) { $env:START_PORT } else { "3000" }
$url = "http://${hostName}:$port"

Write-Step "Starting Next.js dev server"
Write-Host "URL: $url" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor DarkGray

Invoke-Pnpm dev --hostname $hostName --port $port
