# TPA코리아 메신저 서버 운영 메모

> ⚠️ **TPA 서버는 Docker를 쓰지 않는다.** Windows에 Node.js를 직접 설치해 메신저 서버를 실행한다.
> `docker compose ...` 명령은 이 서버에서 쓰지 않는다. 서버 코드 업데이트는 `scripts/deploy-partner-server.ps1`(Node 기준)을 쓴다.

## 서버

| 항목 | 값 |
|---|---|
| 서버 | 이맥스 자체 관리 **Windows** 서버 `114.203.209.5` (공인 IP 직접 보유, 포트포워딩 없음) |
| 원격 접속 | RDP `114.203.209.5:4405` (administrator) |
| 설치 위치 | `G:\MESSAGE` |
| 실행 방식 | **Node.js 직접 실행 (Docker 아님)**, `0.0.0.0:3001`에서 대기 |
| 같은 서버의 다른 서비스 | 443 = Tomcat9 (그룹웨어 `tpakorea-gw.co.kr`), 80 = IIS |

## 접속 주소

| 용도 | 주소 |
|---|---|
| 앱 접속 (v1.2.60~) | `https://msg.tpakorea-gw.co.kr:3443` (Caddy → node 3001) |
| 구버전 앱 | `http://114.203.209.5:3001`. 전원이 업데이트하면 방화벽 3001 인바운드를 닫는다. |
| 앱 릴리즈 / 자동 업데이트 | GitHub `emax-project/TPAKOREA_MESSENGER` Releases (git remote `tpakorea`) |

- 포트 없이 `https://msg.tpakorea-gw.co.kr`로 접속하면 443(그룹웨어)으로 간다. 이건 의도한 동작이고 그대로 둔다.

## HTTPS 구성 (2026-11-05)

- **Caddy**: `C:\caddy\caddy.exe`, 설정 `C:\caddy\Caddyfile`, Windows 서비스 `caddy` (자동 시작)
- **인증서**: win-acme `C:\win-acme`, Let's Encrypt. PEM은 `G:\MESSAGE\certs`에 저장된다.
  - 작업 스케줄러 `win-acme renew`가 자동 갱신하고, 갱신 후 `G:\MESSAGE\certs\restart-caddy.ps1`로 Caddy를 재시작한다.
- 자세한 절차: `docs/HTTPS-TPAKOREA.md`

## 설정값 / 계정 확인 (Node 직접 실행 기준)

메신저 서버는 실행 폴더의 `.env`를 읽는다. 먼저 node가 어디서 어떻게 실행 중인지 확인한다.

```powershell
# 3001을 쓰는 node 프로세스의 실행 명령줄 (실행 경로 확인)
$procId = (Get-NetTCPConnection -LocalPort 3001 -State Listen).OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=$procId" | Select-Object ProcessId, CommandLine, ExecutablePath

# .env 위치 찾기 (node_modules 제외)
Get-ChildItem G:\MESSAGE -Recurse -Force -Filter ".env" -ErrorAction SilentlyContinue |
  Where-Object FullName -notmatch 'node_modules' | Select-Object FullName
```

### 현재 설정 요약 (비밀값은 서버 `.env`에서만 확인, 여기 적지 않음)

| 항목 | 값 |
|---|---|
| 메신저 DB | PostgreSQL **직접 설치**, `localhost:5432`, DB `message` (`DATABASE_URL`) |
| 포트 | `PORT=3001` |
| 어드민 | `ADMIN_EMAIL=admin@admin.com` (쉼표로 여러 개 가능, 이 이메일 계정이 DB에 있어야 함) |
| 조직 동기화 원본 | MSSQL `localhost:1433`, DB `System8_TPA`, 스키마 `tpa_eps`, 사업장 `PARTNER_TPA_BS_CD=A01` |
| 동기화 계정 | 이메일이 없는 직원은 `@tpakorea.local` 가상 이메일로 생성, 초기 비밀번호는 `PARTNER_DEFAULT_PASSWORD` |
| LDAP | 사용 안 함 |

- 테스트 계정 `test1@test.com` / `test2@test.com` (`123456`)은 `npm run db:seed`를 실행했을 때만 생긴다.

### 계정 목록 보기 (PostgreSQL 직접 설치)

```powershell
$psql = (Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" | Select-Object -First 1).FullName
& $psql "postgresql://message:<비밀번호>@localhost:5432/message" `
  -c 'SELECT email, name, "createdAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 20;'
```

## 확인 필요 (아직 문서화 안 됨)

- [ ] node 실행 방식: Windows 서비스 / pm2 / 작업 스케줄러 / 수동 실행 중 무엇인지, 재시작 방법
- [ ] `.env` 정확한 경로 (`packages\server\.env`로 추정 — dotenv가 실행 폴더 기준)
- [ ] PostgreSQL 설치 버전·경로
- [ ] 서버 코드 업데이트(배포) 절차
