# TURN TEASE CARD BATTLE v0.3 Web対戦MVP

## 概要

`aiohttp` と `python-socketio` だけで動作する、TURN TEASE CARD BATTLE v0.3 のWeb対戦MVPです。Discord Botは使わず、Discordビデオチャットなどは別サービスで利用する前提です。

このMVPはゲーム同期と画面演出のみを担当します。実機刺激・BLE・COYOTE制御・SHOCKiG系デバイス連携は未実装です。ただし将来追加できるように、Panic / Stop、同意ロック、ローカルテストロック、visibilitychange停止、heartbeat監視、最終出力リミッターの構造を入れています。

## フォルダ構成

```text
tease-card-battle/
├── server.py
├── game_engine.py
├── requirements.txt
├── README.md
├── deploy/
│   ├── tease-card-battle.service
│   └── install_notes.md
├── static/
│   ├── index.html
│   ├── watch.html
│   ├── app.js
│   ├── watch.js
│   ├── safety.js
│   └── style.css
├── data/
│   └── .gitkeep
└── logs/
    └── .gitkeep
```

## インストール方法

```bash
cd /opt/tokitamado-mflabo/shockig-party/tease-card-battle
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

ホーム配下など開発用パスでも同じ構成なら動作します。

## 起動方法

```bash
PORT=8091 python server.py
```

`PORT` 未指定時のデフォルトポートは `8091` です。

## ブラウザアクセス方法

```text
http://localhost:8091/
```

同一LAN内から利用する場合は、サーバーIPに置き換えます。

```text
http://<server-ip>:8091/
```

## ルーム参加方法

1. Player画面 `/` を開きます。
2. Room ID と表示名を入力します。
3. `Join` を押します。
4. `P1` または `P2` を選びます。埋まっている役割を選んだ場合は `spectator` 扱いになります。
5. 同意チェックを入れます。
6. `ローカルテスト完了` を押します。
7. 両者が `Ready` を押すとカード選択が始まります。

## 観戦方法

```text
http://localhost:8091/watch
```

観戦画面で同じ Room ID を入力して参加します。観戦者は操作ボタンを持たず、P1/P2のHP・TP・帯電、LOCK状態、公開カード、結果ログ、継続状態を確認できます。

## systemd化の手順

```bash
sudo cp deploy/tease-card-battle.service /etc/systemd/system/tease-card-battle.service
sudo systemctl daemon-reload
sudo systemctl enable --now tease-card-battle.service
journalctl -u tease-card-battle.service -f
```

サービス例では以下を想定しています。

- WorkingDirectory: `/opt/tokitamado-mflabo/shockig-party/tease-card-battle`
- User: `ubuntu`
- PORT: `8091`

## Cloudflare Tunnelで公開する場合の注意

```bash
cloudflared tunnel --url http://localhost:8091
```

- Socket.IO のWebSocket通信が通ることを確認してください。
- 公開URLは参加者だけに共有してください。
- 既存SHOCKiG系サービスとは必ず別ポートにしてください。
- Discordビデオチャットは別途利用し、このアプリはWeb上のゲーム同期のみを担当します。

## 実機連携は未実装

このMVPは実機刺激・BLE・COYOTE制御を一切行いません。`continuous_state` は画面演出用のゲーム内状態です。`intensity_hint` は将来の演出・連携用ヒント値であり、実機出力値ではありません。

## 安全上の注意

- Panic / Stop ボタンは常時画面下部に固定表示されています。
- 同意チェック完了前はカード操作できません。
- ローカルテスト完了前はカード操作できません。
- ページが非表示になった瞬間にローカル停止状態へ入ります。
- heartbeat途絶時にローカル停止状態へ入ります。
- 将来の外部制御値は `maxOutputPercent` で最終クランプされ、100%を超えない構造です。
