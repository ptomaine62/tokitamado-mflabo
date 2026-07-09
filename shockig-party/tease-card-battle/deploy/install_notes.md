# Install Notes

## フォルダ作成

```bash
sudo mkdir -p /opt/tokitamado-mflabo/shockig-party/tease-card-battle
sudo chown -R ubuntu:ubuntu /opt/tokitamado-mflabo/shockig-party
cd /opt/tokitamado-mflabo/shockig-party/tease-card-battle
```

## venv作成

```bash
python3.11 -m venv .venv
source .venv/bin/activate
```

## pip install

```bash
pip install -r requirements.txt
```

## 手動起動

```bash
PORT=8091 python server.py
```

## systemd登録

```bash
sudo cp deploy/tease-card-battle.service /etc/systemd/system/tease-card-battle.service
sudo systemctl daemon-reload
sudo systemctl enable --now tease-card-battle.service
```

## journalctl確認

```bash
journalctl -u tease-card-battle.service -f
```

## Cloudflare Tunnel公開例

```bash
cloudflared tunnel --url http://localhost:8091
```

WebSocket / Socket.IO が通る設定にしてください。公開URLは参加者だけに共有し、Panic / Stop の挙動を事前に確認してください。

## 既存SHOCKiG系サービスとの分離

既存SHOCKiG系サービスとポートを分けてください。このMVPは `8091` を使います。実機刺激・BLE・COYOTE制御は未実装です。
