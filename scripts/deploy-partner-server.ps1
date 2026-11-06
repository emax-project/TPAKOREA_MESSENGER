# TPA코리아 — 이맥스 자체 서버(Windows, 114.203.209.5) 서버 코드 업데이트
# ※ 이 서버는 Docker를 쓰지 않는다. Node.js + PostgreSQL을 Windows에 직접 설치해 실행한다.
#    운영 정보: docs/TPAKOREA-SERVER.md / HTTPS(Caddy·인증서): docs/HTTPS-TPAKOREA.md
#
# RDP(114.203.209.5:4405, administrator) 접속 후 PowerShell(관리자)에서 실행:
#   cd G:\MESSAGE
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\scripts\deploy-partner-server.ps1              # 코드 업데이트 + 의존성 + DB 스키마 반영 + 재시작
#   .\scripts\deploy-partner-server.ps1 -SyncUsers   # + ERP(MSSQL) 조직/사용자 동기화
#
# 순서: git pull → 서버 중지 → npm ci → prisma generate / db push → 서버 시작 → 3001/3443 확인
#  - npm ci 전에 서버를 끈다: 실행 중인 node가 Prisma 엔진 DLL을 잡고 있으면 EPERM으로 실패한다.
#  - DB는 처음에 prisma db push로 만들어져 _prisma_migrations 기록이 없다 → migrate deploy 대신 db push.
#    db push는 데이터가 지워지는 변경이면 스스로 거부하고 멈춘다(--accept-data-loss는 절대 붙이지 않는다).
#  - 중간 단계가 실패해도 finally에서 서버를 다시 켠다(서버가 꺼진 채로 남지 않게).
#
# 최초 설치 시:
#   - Node.js, Git, PostgreSQL(localhost:5432, DB/계정 message) 설치
#   - copy .env.partner.example packages\server\.env 후 비밀값(JWT_SECRET, DB/MSSQL 비밀번호) 입력
#     (서버는 packages\server 에서 실행되며 dotenv가 그 폴더의 .env를 읽는다)
#
# ※ 이 파일은 UTF-8(BOM 포함)으로 저장한다 — Windows PowerShell 5가 BOM 없는 UTF-8 한글을 깨뜨린다.

param(
  [switch]$SyncUsers,
  # node 서버를 띄우는 작업 스케줄러 작업 (node.exe G:\MESSAGE\packages\server\src\index.js, 시작 폴더 packages\server)
  [string]$TaskName = "TPAMessenger"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Server = Join-Path $Root "packages\server"
Set-Location $Root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw "node 명령을 찾을 수 없습니다. Node.js를 설치하세요." }
if (-not (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) { throw "작업 스케줄러 '$TaskName' 없음" }
if (-not (Test-Path (Join-Path $Server ".env"))) {
  throw "packages\server\.env 없음. copy .env.partner.example packages\server\.env 후 값을 채우세요."
}

Write-Host "==> git pull (tpakorea main)"
git pull --ff-only
if ($LASTEXITCODE -ne 0) { throw "git pull 실패 — git status로 서버에서 직접 고친 파일이 있는지 확인" }

function Stop-MessengerServer {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  # 혹시 남아 있는 3001 리스너(node) 정리
  $left = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
  if ($left) {
    $left | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
  }
}

$failed = $null
Write-Host "==> stop node (작업 스케줄러 $TaskName) — 이 동안 메신저 접속이 잠깐 끊깁니다"
Stop-MessengerServer
try {
  # npm workspaces 구조 — lock 파일은 루트에 있으므로 루트에서 server 워크스페이스만 설치
  # (prisma CLI가 devDependency라 --omit=dev 쓰면 안 됨)
  Write-Host "==> npm ci (server workspace)"
  Set-Location $Root
  npm ci --workspace packages/server
  if ($LASTEXITCODE -ne 0) { throw "npm ci 실패" }

  Set-Location $Server
  Write-Host "==> prisma generate"
  npm run db:generate
  if ($LASTEXITCODE -ne 0) { throw "prisma generate 실패" }

  Write-Host "==> prisma db push (스키마 반영 — 데이터 손실이 생기는 변경이면 거부하고 멈춤)"
  npx prisma db push --skip-generate
  if ($LASTEXITCODE -ne 0) { throw "prisma db push 실패 — 데이터 손실 경고라면 수동 확인 필요(--accept-data-loss 금지)" }
} catch {
  $failed = $_
} finally {
  Write-Host "==> start node (작업 스케줄러 $TaskName)"
  Start-ScheduledTask -TaskName $TaskName
  Set-Location $Root
}

Write-Host "==> wait for API http://127.0.0.1:3001/"
$ok = $false
for ($i = 1; $i -le 40; $i++) {
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:3001/" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -ge 200) { $ok = $true; break }
  } catch { Start-Sleep -Seconds 2 }
}
if ($ok) { Write-Host "API up (3001)" } else { Write-Warning "API(3001)가 응답하지 않습니다 — node 서버 로그 확인" }

try {
  $r = Invoke-WebRequest -Uri "https://msg.tpakorea-gw.co.kr:3443/" -UseBasicParsing -TimeoutSec 5
  Write-Host "HTTPS up (3443, Caddy) — $($r.StatusCode)"
} catch {
  Write-Warning "HTTPS(3443) 응답 없음 — Get-Service caddy 확인"
}

if ($failed) { throw "배포 중 실패(서버는 다시 켰음): $failed" }
if (-not $ok) { throw "API(3001) 응답 없음" }

if ($SyncUsers) {
  Write-Host "==> partner org sync (create users)"
  Set-Location $Server
  npm run partner:org:sync:users
  $code = $LASTEXITCODE
  Set-Location $Root
  if ($code -ne 0) { throw "조직 동기화 실패" }
}

Write-Host "==> done"
Write-Host "앱 접속 주소: https://msg.tpakorea-gw.co.kr:3443 (v1.2.60~)  /  구버전: http://114.203.209.5:3001"
