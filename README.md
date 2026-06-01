# Sakurauta

スマホ向けの「歌ってみたWAV」ライブラリPWAです。

## 構成

- PWA本体: このリポジトリ
- 曲一覧: Google Apps Script API
- WAV実体: Cloudflare R2

## 現在の設定

`app.js` の先頭で指定しています。

```js
const API_URL = "https://script.google.com/macros/s/AKfycbz2PjeyxX01bEjnGa0nkliICSxpAQhFC73qm78eAO6UTZzOAz1liBUN-26PVa7UDzrRuw/exec";
const R2_BASE_URL = "https://pub-3b279d63cf3f4efdb626192fa8e22ef2.r2.dev/";
```

## ローカル確認

```bash
python -m http.server 4173
```

ブラウザで `http://127.0.0.1:4173/` を開きます。

APIなしで画面だけ確認する場合は、URLの末尾に `?demo=1` を付けます。

```text
http://127.0.0.1:4173/?demo=1
```
