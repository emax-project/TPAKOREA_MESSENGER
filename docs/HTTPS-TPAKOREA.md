# TPA코리아 메신저 HTTPS 적용 가이드

> ✅ **적용 완료 (2026-11-05, 앱 v1.2.60)**. 남은 일: 3001 인바운드 닫기 (7단계). 운영 정보는 `docs/TPAKOREA-SERVER.md`.
>
> 작성: 2026-11-05 · 대상 서버: 이맥스 자체 Windows 서버 `114.203.209.5` (RDP `:4405`, 설치 경로 `G:\MESSAGE`)

## 현황

| 항목 | 내용 |
|---|---|
| 메신저 서버 | node, `0.0.0.0:3001` (HTTP) |
| 443 | **Tomcat9** — 그룹웨어 (`tpakorea-gw.co.kr`, Sectigo 인증서, 만료 2027-01-29) |
| 80 | **IIS (W3SVC)** |
| 방화벽 인바운드 | 80 / 443 / 3001 허용됨 |
| 클라이언트 접속 주소 | `http://114.203.209.5:3001` (`.github/workflows/release.yml`의 `VITE_API_URL`) |

그룹웨어 도메인과 인증서는 그룹웨어 전용이라 **같이 쓰지 않는다.** 메신저는 전용 서브도메인과 Let's Encrypt 인증서를 쓰고, Tomcat(443)과 IIS(80)는 건드리지 않는다.

## 구성

```
클라이언트 ──https──▶ msg.tpakorea-gw.co.kr:3443 ── Caddy ──▶ node 127.0.0.1:3001
                                     ▲
              win-acme: Let's Encrypt 발급·자동 갱신 (selfhosting 검증, IIS와 80 공유)
```

- **win-acme**: 인증서를 발급받아 PEM 파일로 저장한다. 갱신은 작업 스케줄러에 등록돼 자동으로 돌고, 갱신 후 Caddy를 재시작한다.
- **Caddy**: 3443에서 HTTPS를 받아 3001로 넘긴다. WebSocket(Socket.io)도 자동으로 처리한다.

---

## 1단계: DNS 등록 요청 (TPA 담당자)

- [x] 요청 문구: "메신저 서비스용으로 `msg.tpakorea-gw.co.kr` A 레코드를 `114.203.209.5`로 추가해 주실 수 있을까요? 같은 서버라 인증서와 서버 설정은 저희가 처리하겠습니다."
- [x] 반영 확인 (Mac): `dig +short msg.tpakorea-gw.co.kr` 결과가 `114.203.209.5`인지

DNS가 반영되기 전에는 2단계가 실패한다.

## 2단계: 인증서 발급 (서버, PowerShell 관리자)

1. [win-acme](https://www.win-acme.com/) x64 zip을 내려받아 `C:\win-acme`에 압축을 푼다.
2. 저장 폴더와 갱신 후 실행할 스크립트를 만든다.
   ```powershell
   mkdir G:\MESSAGE\certs
   'Restart-Service caddy' | Out-File G:\MESSAGE\certs\restart-caddy.ps1 -Encoding ascii
   ```
3. 인증서를 발급한다. 갱신 작업도 작업 스케줄러에 자동으로 등록된다.
   ```powershell
   cd C:\win-acme
   .\wacs.exe --source manual --host msg.tpakorea-gw.co.kr `
     --validation selfhosting `
     --store pemfiles --pemfilespath G:\MESSAGE\certs `
     --installation script --script G:\MESSAGE\certs\restart-caddy.ps1 `
     --accepttos --emailaddress do.hy824@gmail.com
   ```
   - `selfhosting` 검증은 HTTP.sys를 쓰기 때문에 IIS와 80을 공유해도 충돌하지 않는다.
   - 처음 실행할 때는 아직 Caddy 서비스가 없어서 재시작 스크립트에서 오류가 날 수 있다. 인증서만 만들어졌으면 무시해도 된다.
- [x] 확인: `G:\MESSAGE\certs`에 `*-chain.pem`과 `*-key.pem` 파일이 생겼는지

## 3단계: Caddy 설치와 서비스 등록

1. [Caddy](https://caddyserver.com/download)에서 Windows amd64용 `caddy.exe`를 받아 `C:\caddy\`에 둔다.
2. `C:\caddy\Caddyfile`을 만든다. 인증서 파일 이름은 2단계에서 실제로 생긴 이름에 맞춘다.
   ```
   {
       auto_https off
   }
   https://msg.tpakorea-gw.co.kr:3443 {
       tls G:/MESSAGE/certs/msg.tpakorea-gw.co.kr-chain.pem G:/MESSAGE/certs/msg.tpakorea-gw.co.kr-key.pem
       request_body {
           max_size 2GB
       }
       reverse_proxy 127.0.0.1:3001
   }
   ```
   - `auto_https off`: Caddy가 80을 잡으려다 IIS와 충돌하는 것을 막는다.
   - `max_size 2GB`: 서버 업로드 한도(`packages/server/src/upload.js`의 `MAX_FILE_SIZE`)에 맞춘 값이다.
3. 서비스 등록 전에 먼저 직접 띄워서 테스트한다.
   ```powershell
   cd C:\caddy; .\caddy.exe run --config Caddyfile
   ```
4. 문제가 없으면 Ctrl+C로 끄고 서비스로 등록한다. Caddy는 Windows 서비스를 자체 지원하므로 NSSM이 필요 없다.
   ```powershell
   sc.exe create caddy start= auto binPath= "C:\caddy\caddy.exe run --config C:\caddy\Caddyfile"
   Start-Service caddy
   ```

## 4단계: 방화벽 열기

```powershell
New-NetFirewallRule -DisplayName "Messenger HTTPS 3443" -Direction Inbound -Protocol TCP -LocalPort 3443 -Action Allow
```

## 5단계: 외부 동작 확인 (Mac)

- [x] `curl -I https://msg.tpakorea-gw.co.kr:3443/` 결과가 인증서 오류 없이 응답하는지
- [x] 브라우저로 접속했을 때 자물쇠 아이콘과 서버 안내 페이지가 보이는지

## 6단계: 앱 릴리즈 (이 저장소)

1. `.github/workflows/release.yml`의 `VITE_API_URL`을 `https://msg.tpakorea-gw.co.kr:3443`으로 바꾼다.
2. 버전을 올리고 커밋한 뒤 `tpakorea` 원격에 태그를 push해서 빌드한다.
3. [ ] 설치한 앱으로 로그인, 메시지 송수신(실시간), 파일 전송, 아바타 표시를 확인한다.

자동 업데이트는 GitHub 릴리즈(TPAKOREA_MESSENGER)에서 받으므로 서버 주소 변경과 상관없다. 기존 사용자도 정상적으로 업데이트된다.

## 7단계: 전환 마무리

- [ ] 모든 사용자가 새 버전으로 업데이트할 때까지 **3001 인바운드는 유지한다.** 구버전 앱은 `http://114.203.209.5:3001`로 접속한다.
- [ ] 전원 업데이트가 끝나면 방화벽에서 3001 인바운드 규칙을 닫는다. Caddy는 `127.0.0.1`로 접속하므로 영향이 없다.
- [ ] 약 2개월 뒤 자동 갱신이 됐는지 확인한다. 작업 스케줄러의 win-acme 작업과 인증서 만료일을 본다.

## 진행 기록 (2026-11-05)

- DNS: 거래처가 카페24에서 `msg.tpakorea-gw.co.kr` A 레코드 등록 (원래 계획은 `messenger.`였으나 `msg.`로 결정)
- 인증서: win-acme 2.2.9로 발급 (http-01 selfhosting 검증 통과), 만료 2027-02-03, 다음 갱신 2026-12-30 이후
- Caddy: `sc.exe`로 서비스 등록, 외부 확인 결과 HTTPS 200, WebSocket 업그레이드 101
- 앱 v1.2.60 릴리즈: `VITE_API_URL` 변경, 로그인 시 저장된 예전 HTTP 주소를 무시하도록 `api.ts` 수정
- 결정: 포트 없는 `msg.tpakorea-gw.co.kr`(443)는 그룹웨어로 가는 상태 그대로 둠

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| win-acme 검증 실패 | DNS 반영 여부, 방화벽 80 인바운드 |
| 로그인은 되는데 실시간 메시지가 안 옴 | Caddy를 거쳐 `/socket.io/`로 연결되는지 (Caddy 로그) |
| 큰 파일 업로드 실패 | Caddyfile의 `request_body max_size` |
| 갱신 후 접속 오류 | `Get-Service caddy` 상태, `G:\MESSAGE\certs`의 파일 날짜 |
