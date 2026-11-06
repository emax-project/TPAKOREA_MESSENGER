# TPA코리아 서버 자동 배포 — 작업 스케줄러가 매일 03:00에 실행
# GitHub(tpakorea main)에 새 커밋이 있으면 받아오고, 서버 관련 파일이 바뀐 경우에만
# deploy-partner-server.ps1(서버 중지 → npm ci → db push → 재시작 → 확인)을 실행한다.
# 결과는 G:\MESSAGE\logs\auto-deploy-yyyyMMdd.log 에 남는다(30일 지난 로그는 삭제).
#
# 작업 등록(서버에서 관리자 PowerShell로 한 번만): docs/TPAKOREA-SERVER.md "자동 배포" 참고
# 수동 실행(테스트): powershell -ExecutionPolicy Bypass -File G:\MESSAGE\scripts\auto-deploy-partner-server.ps1
#
# ※ 이 파일은 UTF-8(BOM 포함)으로 저장한다 — Windows PowerShell 5가 BOM 없는 UTF-8 한글을 깨뜨린다.

param(
  # 이 경로 중 하나라도 바뀌면 서버 재배포 (그 외 — 앱 화면·문서만 바뀐 경우는 git pull만)
  [string[]]$ServerPaths = @('packages/server/', 'package-lock.json', 'package.json')
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogDir = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Get-ChildItem $LogDir -Filter 'auto-deploy-*.log' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force -ErrorAction SilentlyContinue
$Log = Join-Path $LogDir ("auto-deploy-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
Start-Transcript -Path $Log -Append | Out-Null

$exitCode = 0
try {
  Set-Location $Root
  Write-Host ("==> {0} auto-deploy start" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

  git fetch --quiet origin main
  if ($LASTEXITCODE -ne 0) { throw 'git fetch 실패 (네트워크/GitHub 확인)' }

  $local = (git rev-parse HEAD).Trim()
  $remote = (git rev-parse origin/main).Trim()
  if ($local -eq $remote) {
    Write-Host "변경 없음 ($local) — 종료"
    return
  }

  $changed = @(git diff --name-only $local $remote)
  Write-Host ("새 커밋: {0} -> {1} (파일 {2}개)" -f $local.Substring(0,7), $remote.Substring(0,7), $changed.Count)

  $serverChanged = @($changed | Where-Object {
    $f = $_
    $ServerPaths | Where-Object { $f -eq $_ -or ($_.EndsWith('/') -and $f.StartsWith($_)) }
  })

  if ($serverChanged.Count -eq 0) {
    Write-Host '서버 관련 변경 없음 — git pull만 하고 서버는 그대로 둠'
    git pull --ff-only
    if ($LASTEXITCODE -ne 0) { throw 'git pull 실패 — git status로 서버에서 직접 고친 파일이 있는지 확인' }
    return
  }

  Write-Host '서버 관련 변경:'
  $serverChanged | ForEach-Object { Write-Host "  $_" }

  # 배포 스크립트 자체가 바뀌었을 수 있으므로 먼저 받아온 뒤 새 파일을 별도 프로세스로 실행
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'git pull 실패 — git status로 서버에서 직접 고친 파일이 있는지 확인' }

  $deploy = Join-Path $Root 'scripts\deploy-partner-server.ps1'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $deploy
  if ($LASTEXITCODE -ne 0) { throw "deploy-partner-server.ps1 실패 (exit $LASTEXITCODE)" }
  Write-Host '==> 자동 배포 완료'
} catch {
  $exitCode = 1
  Write-Host "!! 자동 배포 실패: $_"
} finally {
  Write-Host ("==> {0} auto-deploy end" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
  Stop-Transcript | Out-Null
}
exit $exitCode
