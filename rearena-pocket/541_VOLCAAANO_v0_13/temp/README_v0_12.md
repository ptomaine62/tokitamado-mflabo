# 541 VOLCAAANO!!! v0.12

## 実行に必要なファイル
GitHub Pagesへアップロードする実行部分は次の3項目だけです。

- `index.html`
- `style.css`
- `js/`

`temp/` は監査・検証・研究資料であり、実行には不要です。

## v0.12
- 穴内部のsoft lerp / 吸着風処理を撤去。
- 穴内部に硬い底面・側壁・低反発衝突・摩擦減衰を追加。
- 捕捉後のsoft sink表示も撤去。
- UP固有の反発・吸着処理は無し。UPの物理差は開口幅モデルのみ。
- iOSでWeb Bluetooth非対応ブラウザだった場合、Bluefy等のWeb BLEブラウザ案内を表示。
- 配布ZIPでは非実行ファイルを `temp/` に隔離。

## iOS
ゲームSIM自体は通常ブラウザで動作するが、REAL E-STIM DEVICE接続にはWeb Bluetoothが必要。
Safari / Chrome iOSの通常環境ではWeb Bluetoothを利用できないため、現時点ではBluefy等のWeb BLE対応ブラウザ + HTTPS（GitHub Pages推奨）を利用する。
