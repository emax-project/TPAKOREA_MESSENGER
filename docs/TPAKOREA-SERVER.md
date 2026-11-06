# TPA코리아 메신저 서버 운영 가이드

> ⚠️ **TPA 서버는 Docker를 쓰지 않는다.** Windows에 Node.js와 PostgreSQL을 직접 설치해서 실행한다.
> 이 서버에서는 `docker compose ...` 명령을 쓰지 않는다. (저장소 루트의 `docker-compose.yml`과 `DEPLOY.md`의 Docker 안내는 다른 환경용이다.)

마지막 갱신: 2026-11-05 (v1.2.60, HTTPS 전환)

---

## 1. 한눈에 보기

```
[PC/모바일 앱 v1.2.60~] ──https──▶ msg.tpakorea-gw.co.kr:3443 ── Caddy(서비스 caddy) ──▶ node :3001 (작업 TPAMessenger)
[구버전 앱 ~v1.2.59]   ──http───▶ 114.203.209.5:3001 ─────────────────────────────────▶      │
                                                                                            ├─ PostgreSQL localhost:5432 (메신저 DB)
                                                                                            └─ MSSQL localhost:1433 (ERP System8_TPA, 조직 동기화 원본)
같은 서버: 443 = Tomcat9 (그룹웨어 tpakorea-gw.co.kr) / 80 = IIS  ← 메신저와 무관, 건드리지 않음
```

| 항목 | 값 |
|---|---|
| 서버 | 이맥스가 직접 관리하는 **Windows** 서버 `114.203.209.5` (공인 IP 직접 보유, 포트포워딩 없음) |
| 원격 접속 | RDP `114.203.209.5:4405` (administrator) |
| 설치 위치 | `G:\MESSAGE` (git 저장소, 원격 = `emax-project/TPAKOREA_MESSENGER`) |
| 설정 파일 | `G:\MESSAGE\packages\server\.env` |
| 앱 릴리즈 / 자동 업데이트 | GitHub `emax-project/TPAKOREA_MESSENGER` Releases |

## 2. 접속 주소

| 용도 | 주소 |
|---|---|
| 앱 접속 (v1.2.60~) | `https://msg.tpakorea-gw.co.kr:3443` |
| 구버전 앱 (~v1.2.59) | `http://114.203.209.5:3001`. 전원이 업데이트하면 3001 인바운드를 닫는다. ([7. 남은 일](#7-남은-일)) |

- 포트 없이 `https://msg.tpakorea-gw.co.kr`로 접속하면 443(그룹웨어 Tomcat)으로 간다. **의도한 동작이므로 그대로 둔다.** 443을 메신저와 나눠 쓰려면 그룹웨어 설정을 바꿔야 해서 하지 않기로 했다.
- DNS: `msg.tpakorea-gw.co.kr` A → `114.203.209.5`. 카페24 DNS 관리에서 거래처가 등록했다. 도메인 등록은 가비아, 네임서버는 카페24다.

## 3. 서버에서 돌아가는 것들

| 이름 | 종류 | 내용 | 포트 |
|---|---|---|---|
| `TPAMessenger` | 작업 스케줄러 | `node.exe G:\MESSAGE\packages\server\src\index.js`, 시작 폴더 `G:\MESSAGE\packages\server` | 3001 |
| `caddy` | Windows 서비스 (자동 시작) | `C:\caddy\caddy.exe run --config C:\caddy\Caddyfile`, HTTPS 처리 후 3001로 전달 | 3443 |
| `win-acme renew (acme-v02.api.letsencrypt.org)` | 작업 스케줄러 (매일) | `C:\win-acme\wacs.exe --renew`, 인증서 자동 갱신 | 80 (검증할 때만, IIS와 공유) |
| PostgreSQL | 직접 설치 | 메신저 DB `message` | 5432 (내부) |
| MSSQL | 기존 ERP | `System8_TPA` (조직 동기화 원본) | 1433 (내부) |

**방화벽 인바운드**: 3443 (`Messenger HTTPS 3443`), 3001 (구버전용, 나중에 닫음), 80/443 (기존 IIS/Tomcat)

### 자주 쓰는 명령 (PowerShell 관리자)

```powershell
# 메신저 서버(node) 재시작
Stop-ScheduledTask TPAMessenger; Start-ScheduledTask TPAMessenger

# 상태 확인
Get-ScheduledTask TPAMessenger | Select-Object TaskName, State
Get-Service caddy
Get-NetTCPConnection -State Listen | Where-Object LocalPort -in 3001,3443

# Caddy 재시작 (Caddyfile 수정 후)
Restart-Service caddy
```

## 4. 서버 코드 업데이트

`G:\MESSAGE`에서 실행한다.

```powershell
cd G:\MESSAGE
Set-ExecutionPolicy Bypass -Scope Process -Force
.\scripts\deploy-partner-server.ps1              # git pull → 서버 중지 → npm ci → prisma db push → 서버 시작 → 3001/3443 확인
.\scripts\deploy-partner-server.ps1 -SyncUsers   # 위 작업 + ERP 조직/사용자 동기화
```

- 스크립트는 `TPAMessenger` 작업을 멈췄다가 다시 시작해서 node를 재시작한다.
- DB 마이그레이션을 같이 실행하므로, 스키마가 바뀐 업데이트 전에는 DB를 백업한다.

## 5. 앱(클라이언트) 릴리즈

1. `.github/workflows/release.yml`의 `VITE_API_URL`이 `https://msg.tpakorea-gw.co.kr:3443`인지 확인한다. 이 주소는 빌드할 때 앱에 고정된다.
2. `packages/client/package.json`의 버전을 올리고 커밋한다.
3. 태그를 push하면 GitHub Actions가 mac/windows 설치파일을 빌드해서 Release에 올린다. 기존 앱은 자동으로 업데이트된다.

> ⚠️ **태그 이름 충돌 주의.** 로컬 저장소에는 CSIN(`csintech`)·MESSAGE(`origin`)의 같은 이름 태그(예: `v1.2.60`)가 이미 있을 수 있다.
> 로컬 태그를 만들어 push하지 말고, **커밋을 직접 지정해서** push한다.
> ```bash
> git push tpakorea <커밋해시>:refs/heads/main <커밋해시>:refs/tags/v1.2.61
> ```
> (2026-11-05에 CSIN의 `v1.2.60` 태그가 TPA 저장소로 잘못 올라가 CSIN 코드로 빌드가 시작된 적이 있다. 빌드를 취소하고 태그를 지워 배포 전에 막았다.)

- 앱은 로그인할 때 서버 주소를 저장하는데, 이 저장값이 빌드 기본값보다 우선한다. 그래서 `packages/client/src/api.ts`의 `LEGACY_API_URLS`에 있는 예전 주소는 무시하도록 처리했다. 나중에 서버 주소를 또 바꾸면 **예전 주소를 이 목록에 추가해야** 기존 사용자가 새 주소로 넘어간다.

## 6. 설정값 / 계정

비밀값(JWT_SECRET, DB·MSSQL 비밀번호)은 서버의 `.env`에만 두고, 여기나 채팅에 적지 않는다.

| 항목 | 값 |
|---|---|
| 메신저 DB | PostgreSQL `localhost:5432`, DB `message` (`DATABASE_URL`) |
| 포트 | `PORT=3001` |
| 어드민 | `ADMIN_EMAIL=admin@admin.com` (쉼표로 여러 개 가능, 이 이메일 계정이 DB에 있어야 함) |
| 조직 동기화 원본 | MSSQL `localhost:1433`, DB `System8_TPA`, 스키마 `tpa_eps`, 사업장 `PARTNER_TPA_BS_CD=A01` |
| 동기화 계정 | 이메일이 없는 직원은 `사번@tpakorea.local` 가상 이메일로 생성, 초기 비밀번호는 `PARTNER_DEFAULT_PASSWORD` |
| LDAP | 사용 안 함 |

- 테스트 계정 `test1@test.com` / `test2@test.com` (`123456`)은 `npm run db:seed`를 실행했을 때만 생긴다.
- 새 서버에 설치할 때는 `copy .env.partner.example packages\server\.env` 후 비밀값을 채운다.

### 계정 목록 보기

```powershell
$psql = (Get-ChildItem "C:\Program Files\PostgreSQL\*\bin\psql.exe" | Select-Object -First 1).FullName
& $psql "postgresql://message:<비밀번호>@localhost:5432/message" `
  -c 'SELECT email, name, "createdAt" FROM "User" ORDER BY "createdAt" DESC LIMIT 20;'
```

## 7. 남은 일

- [ ] PC 한 대에서 v1.2.60 업데이트 후 로그인, 실시간 메시지, 파일 전송 확인
- [ ] 전원 업데이트 확인 후 방화벽 3001 인바운드 닫기
      (`Get-NetTCPConnection -LocalPort 3001 -State Established`의 원격 주소가 전부 `127.0.0.1`이면 닫아도 된다)
- [ ] 2027-01 초: 인증서 자동 갱신 확인 (첫 갱신 예정 2026-12-30 이후, 현재 인증서 만료 2027-02-03)
- [ ] PostgreSQL 설치 버전·경로 기록

## 8. 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 앱 접속 안 됨 | `Get-ScheduledTask TPAMessenger` 상태가 Running인지, `Get-Service caddy`, 방화벽 3443 |
| 로그인은 되는데 실시간 메시지가 안 옴 | Caddy를 거친 WebSocket. Mac에서 `curl`로 `/socket.io/?EIO=4&transport=websocket` 업그레이드 응답 101이 나오는지 |
| 큰 파일 업로드 실패 | `C:\caddy\Caddyfile`의 `request_body max_size` (2GB) |
| 인증서 만료 경고 | 작업 스케줄러 win-acme 작업의 마지막 실행 결과, `G:\MESSAGE\certs` 파일 날짜, 갱신 후 `Restart-Service caddy` |
| 서버 재부팅 후 메신저 안 뜸 | `TPAMessenger` 작업의 트리거(시스템 시작 시)와 실행 계정 |

관련 문서: `docs/HTTPS-TPAKOREA.md` (HTTPS 구축 절차와 기록)
