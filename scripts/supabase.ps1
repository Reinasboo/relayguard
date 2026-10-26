param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $SupabaseArguments
)

$ErrorActionPreference = "Stop"
$secretsPath = Join-Path (Split-Path $PSScriptRoot -Parent) ".env.supabase.local"
if (-not (Test-Path $secretsPath)) {
  throw "Create .env.supabase.local with SUPABASE_ACCESS_TOKEN=... before running Supabase CLI commands."
}

$tokenLine = Get-Content $secretsPath | Where-Object { $_ -match '^\s*SUPABASE_ACCESS_TOKEN=' } | Select-Object -Last 1
if (-not $tokenLine -or $tokenLine -notmatch '^\s*SUPABASE_ACCESS_TOKEN=(.+?)\s*$') {
  throw ".env.supabase.local must contain a non-empty SUPABASE_ACCESS_TOKEN value."
}

$token = $Matches[1].Trim().Trim('"').Trim("'")
if (-not $token) {
  throw ".env.supabase.local must contain a non-empty SUPABASE_ACCESS_TOKEN value."
}

$passwordLine = Get-Content $secretsPath | Where-Object { $_ -match '^\s*SUPABASE_DB_PASSWORD=' } | Select-Object -Last 1
if ($passwordLine -match '^\s*SUPABASE_DB_PASSWORD=(.+?)\s*$') {
  $env:SUPABASE_DB_PASSWORD = $Matches[1].Trim().Trim('"').Trim("'")
}

$env:SUPABASE_ACCESS_TOKEN = $token
try {
  & npx supabase @SupabaseArguments
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Remove-Item Env:SUPABASE_ACCESS_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:SUPABASE_DB_PASSWORD -ErrorAction SilentlyContinue
}
