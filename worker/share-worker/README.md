# sak_Uta share Worker

共有相手に全曲APIやR2の公開URLを渡さず、発行したランダムURLに対応する1曲だけを再生するWorkerです。

## Cloudflare resources

- Worker: `sakuta-share`
- KV binding: `SHARE_LINKS`
- R2 binding: `SAKURAUTA_WAVS`
- Secret: `SHARE_ADMIN_TOKEN`

## Endpoints

- `POST /api/shares`: 管理トークンを使って共有リンクを発行
- `GET /api/shares/:token`: 共有可能な曲情報を1件だけ返す
- `GET /audio/:token`: 対象WAVだけをRange対応で配信
- `GET /s/:token`: 外部向けの共有プレイヤー
- `DELETE /api/shares/:token`: 共有リンクを無効化

共有リンクは既定で30日間有効です。R2 bindingが利用できない移行期間だけ、KVに保存した公開R2 URLをWorkerが代理取得します。
