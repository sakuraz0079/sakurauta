# sak_Uta

スマホ向けの「歌ってみたWAV」ライブラリPWAです。

## 構成

- PWA本体: このリポジトリ
- 曲一覧: Google Apps Script API
- WAV配信: Cloudflare R2
- 公開版: https://sakuraz0079.github.io/sakurauta/

## 現在の設定

`app.js` の先頭でAPI URLを指定しています。

```js
const API_URL = "https://script.google.com/macros/s/AKfycbz2PjeyxX01bEjnGa0nkliICSxpAQhFC73qm78eAO6UTZzOAz1liBUN-26PVa7UDzrRuw/exec";
```

WAVのURLは、APIから返る曲データ内のURLを使用します。

## ローカル確認

このプロジェクトは静的ファイルだけで動きます。npm install は不要です。

```bash
python -m http.server 4173
```

ブラウザで開きます。

```text
http://127.0.0.1:4173/
```

APIなしで画面だけ確認したい場合は、URLの末尾に `?demo=1` を付けます。

```text
http://127.0.0.1:4173/?demo=1
```

## スマホ実機確認

PCとスマホを同じWi-Fiに接続して、PC側で次を実行します。

```bash
python -m http.server 4173 --bind 0.0.0.0
```

`ipconfig` でPCのIPv4アドレスを確認し、スマホのブラウザで次の形式のURLを開きます。

```text
http://PCのIPv4アドレス:4173/
```
