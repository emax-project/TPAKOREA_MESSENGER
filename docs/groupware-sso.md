# 그룹웨어 SSO 연동 규격 (1회용 토큰)

메신저에서 그룹웨어·메일 버튼을 누르면 **비밀번호 없이** 그룹웨어에 로그인되도록 하는 연동입니다.
메신저는 1회용 토큰만 발급하고, 그룹웨어가 그 토큰을 메신저 서버에 확인해 로그인 세션을 만듭니다.

## 흐름

```
1. 사용자가 메신저에서 [그룹웨어] 또는 [메일] 클릭
2. 메신저 → 메신저 서버   POST /sso/token           (로그인한 사용자 본인 것)
                          ← { token, expiresIn: 60 }
3. 메신저 → 기본 브라우저  GET  {그룹웨어주소}{SSO경로}?token=...[&next=...]
4. 그룹웨어 → 메신저 서버  POST /sso/verify          (서버 간 호출, X-SSO-Key)
                          ← { ok, userId, email, username, name }
5. 그룹웨어가 해당 사용자로 로그인 세션을 만들고, 토큰이 없는 주소로 이동(redirect)
```

토큰 발급이 실패하거나 SSO가 꺼져 있으면 메신저는 기존처럼 그룹웨어 주소만 엽니다(사용자가 직접 로그인).

## 그룹웨어가 만들어야 하는 것

**SSO 진입 주소** — 메신저가 여는 주소: `{그룹웨어주소}{SSO경로}?token={토큰}[&next={이동할 주소}]`
(SSO 경로 기본값은 `/sso`이며 메신저 관리자 설정에서 바꿀 수 있습니다.)

1. `token` 파라미터를 받는다.
2. 아래 **검증 API**를 서버에서 호출한다.
3. `ok: true`이면 응답의 사용자(`email` 또는 `username`)와 그룹웨어 계정을 맞춰 로그인 세션을 만든다.
4. **토큰이 주소에 남지 않도록** 세션 생성 직후 토큰 없는 주소로 redirect 한다.
5. `next`가 있으면 로그인 후 그 주소로 보낸다. **같은 사이트(그룹웨어 도메인)의 주소인지 반드시 검증**한다(오픈 리다이렉트 방지). 없거나 검증에 실패하면 그룹웨어 메인으로 보낸다.
6. `ok: false`(만료·재사용·위조)이면 로그인 세션을 만들지 말고 일반 로그인 화면으로 보낸다.

## 검증 API

`POST {메신저서버}/sso/verify` (`/api/sso/verify`도 동일)

| 항목 | 값 |
|---|---|
| 헤더 | `X-SSO-Key: {공유 키}` — 메신저 서버의 `SSO_SHARED_KEY`와 같은 값 |
| 헤더 | `Content-Type: application/json` |
| 본문 | `{ "token": "..." }` |

성공 (HTTP 200):

```json
{ "ok": true, "userId": "cm...", "email": "hong@csin.kr", "username": "hong", "name": "홍길동" }
```

실패: `401 { "ok": false }` (키 불일치·토큰 만료/재사용/없음), `403 { "ok": false }` (메신저에서 SSO 꺼짐),
`503 { "ok": false, "error": "SSO not configured" }` (서버에 공유 키 미설정).

- 토큰은 **한 번만** 유효합니다. 검증에 성공하면 즉시 폐기되어 같은 토큰으로 다시 호출하면 401입니다.
- 토큰 유효 시간은 **60초**입니다. 사용자가 클릭한 직후 호출하세요.
- `username`은 이메일의 `@` 앞부분(예: `hong@csin.kr` → `hong`)입니다. 그룹웨어 로그인 아이디와 맞는 쪽(`email` 또는 `username`)으로 계정을 찾으세요.
- 분당 300회까지 호출할 수 있습니다.

### 호출 예시

```bash
curl -s -X POST https://msg.csin.kr/sso/verify \
  -H "Content-Type: application/json" \
  -H "X-SSO-Key: <공유 키>" \
  -d '{"token":"<토큰>"}'
```

Java(JSP/서블릿) 예시:

```java
URL url = new URL("https://msg.csin.kr/sso/verify");
HttpURLConnection c = (HttpURLConnection) url.openConnection();
c.setRequestMethod("POST");
c.setDoOutput(true);
c.setRequestProperty("Content-Type", "application/json");
c.setRequestProperty("X-SSO-Key", SSO_SHARED_KEY);
c.setConnectTimeout(3000);
c.setReadTimeout(5000);
String body = "{\"token\":\"" + token.replaceAll("[^A-Za-z0-9_-]", "") + "\"}"; // 토큰은 base64url 문자만
try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes("UTF-8")); }
int status = c.getResponseCode();   // 200이면 성공, 그 외는 로그인 거부
// 응답 JSON에서 ok / email / username 을 읽는다
```

## 설정 (메신저 쪽)

1. 긴 랜덤 문자열을 만든다(예: `openssl rand -base64 32`). 그룹웨어 서버에도 같은 값을 보관한다.
2. 메신저 서버 환경 변수 `SSO_SHARED_KEY`에 넣는다(GitHub Actions를 쓴다면 저장소 Secrets에 `SSO_SHARED_KEY` 등록).
3. 메신저 관리자 설정 화면 > **그룹웨어 SSO**에서 경로(기본 `/sso`)를 확인하고 **SSO 사용**을 켠다.
   그룹웨어가 준비되기 전에는 꺼 둔다.

## 보안 메모

- 토큰 원문은 서버에 저장하지 않고 해시만 저장합니다. 유효 시간 60초, 1회용입니다.
- 토큰은 주소(URL)에 실리므로 브라우저 기록·서버 로그에 남을 수 있습니다. 그룹웨어는 로그에 `token` 값을 남기지 않고, 세션 생성 직후 토큰 없는 주소로 이동시키세요.
- 검증 API는 서버 간 호출 전용입니다. 가능하면 방화벽에서 그룹웨어 서버 IP만 허용하세요.
- 공유 키가 유출되면 키를 교체하세요(메신저·그룹웨어 양쪽 동시 변경).
