# iOS / Web Bluetooth

2026-08-26時点:

- Safari / iOS: Web Bluetoothをネイティブサポートしていない。
- Chrome / iPhone・iPad: Google公式ヘルプ上、BluetoothデバイスとWebサイトの接続は非対応。
- 日本ではiOS 26.2以降、制度上は代替ブラウザエンジンが許可されているが、インストール済みの一般ブラウザがWeb Bluetoothを提供しているかは各ブラウザ実装次第。
- 現状の簡単な実行方法: BluefyなどWeb BLE対応iOSブラウザでHTTPS版を開く。
- BluefyはHTTPSを要求するため、GitHub Pages公開は適合する。

推奨:
1. GitHubへ `index.html`, `style.css`, `js/` を配置。
2. GitHub Pagesを有効化しHTTPS URLを得る。
3. iOSではBluefyでそのURLを開く。
4. REAL -> CONNECTをユーザー操作で実行する。

通常のゲーム部分だけならSafariでも動作可能だが、E-STIM DEVICEのBLE接続部分は `navigator.bluetooth` が必要。
