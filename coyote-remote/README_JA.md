# E-STIM REMOTE WEB v0.2.0-alpha

E-STIMデバイスを受信側PCへ接続し、送信側・閲覧側がROOMへ参加するブラウザアプリです。

## 公開URL

https://mflabo.tokitamado.com/coyote-remote/

URLパスは互換性のため `/coyote-remote/` のままですが、画面上の製品名は E-STIM / E-STIMデバイス を使用します。

## 役割

### 受信側
1. E-STIMデバイスを接続
2. ROOMを開始
3. QRコード / 参加URLを相手へ共有
4. 接続申請を許可
5. REAL出力時は REAL REMOTE READY を明示的にARM
6. LIMIT / ALL ZERO / E-STOP は受信側が最終権限

### 送信側
1. QRコードを読む、またはROOM CODEを入力
2. 表示名を確認
3. 「接続を申請する」を押す
4. 受信側の許可後に E-STIM A/B を操作
5. 操作権が他の送信側へ移った場合はROOM内で待機

### 閲覧側
1. ROOMへ参加
2. 刺激・グラフ・イベントログを読み取り専用で確認
3. 刺激操作は送信しない

## 通信

- 同一PC: BroadcastChannel
- 別PC / スマホ: PeerJS + WebRTC DataChannel
- Signaling: PeerJS Cloud
- 実刺激データはWebRTC DataChannel経由でブラウザ間通信
- 一部の携帯回線・対称NATではTURNリレーが必要になる場合があります

## 複数送信側

ROOMへ複数の送信側が参加できますが、刺激を操作できる送信側は常に1人です。
受信側が別の送信側へ操作権を渡す場合、先にZEROへして現在の操作権を解除してから新しい送信側を許可します。
閲覧側は読み取り専用です。

## 安全

- BLE切断 / heartbeat途絶 / 非アクティブ化 / Write失敗 / E-STOP でZERO
- REAL出力は受信側の明示ARMが必要
- 再接続後は非ZEROを自動復元しません
- A/B LIMIT初期値50%
