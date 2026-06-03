# R2 WAV upload worker

ブラウザからWAVをR2へ直接送らず、Worker経由でアップロードするためのひな形です。

## Cloudflare側で必要な設定

- R2 bucket binding: `SAKURAUTA_WAVS`
- Secret: `UPLOAD_TOKEN`
- Variable: `PUBLIC_BASE_URL`

`PUBLIC_BASE_URL` はR2の公開URLです。

```text
https://pub-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.r2.dev
```

## 返却形式

```json
{
  "ok": true,
  "fileName": "artist_title_Mastering-1.wav",
  "url": "https://pub-...r2.dev/artist_title_Mastering-1.wav"
}
```
