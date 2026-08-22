# 그림 변환 워커

아이 그림을 fal 로 보내 완성된 그림으로 돌려준다. 이 서버가 존재하는 이유는 **fal 키를 앱에서
떼어놓기 위해서**다. 키가 앱에 있으면 APK 를 뜯어 누구나 쓸 수 있다.

## 배포

```bash
cd backend/worker
npx wrangler login                       # 브라우저에서 Cloudflare 로그인
npx wrangler secret put FAL_KEY          # fal 키를 붙여넣는다 (코드에 넣지 않는다)
npx wrangler deploy
```

배포가 끝나면 `https://storydot-character.<계정>.workers.dev` 주소가 나온다. 그 주소를 앱의
`CHARACTER_API` 에 넣는다.

## 확인

```bash
curl https://storydot-character.<계정>.workers.dev/health
```

## 요청

```
POST /generate-character
{ "imageBase64": "<PNG base64>", "topic": "바다" }
→ { "ok": true, "mimeType": "image/png", "imageBase64": "..." }
```
