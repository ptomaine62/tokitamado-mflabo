# COYOTE REMOTE WEB v0.1.9-alpha

UNIFIED HAPTIC LAB v0.3.13 の COYOTE 系統を基礎にした COYOTE専用 Web/PWA/配布HTML 試作版です。

## 起動

ZIPを展開し、`index.html` を Google Chrome / Microsoft Edge で開いてください。

- UI / SIM: `file://` 直開き対応
- Pythonサーバー: 不要
- 公式プリセット: 24種内包
- 役割: 受信側 / 送信側 / 閲覧側
- 日本語 / English 切替
- Dark / Light

## v0.1.9 の重点変更

### 1. BLE表示と物理GATT状態を同期

v0.1.8では `gattserverdisconnected` の一時イベントが接続中にも遅れて届くケースで、UIだけOFFLINE/DISCONNECTED相当になる余地がありました。

v0.1.9では表示時にも `device.gatt.connected` を確認し、物理GATTが接続中ならREADYを維持します。接続/再試行中や意図的切断中のdisconnectedイベントも誤切断扱いしません。

### 2. 接続申請を固定HUD化

受信側の接続申請はページ最上部の通常フローではなく、画面上に固定される申請HUDへ変更しました。

- スクロール位置に関係なく表示
- `接続を許可` / `確認する` をその場で操作
- 送信側の申請を見失いにくい

### 3. 送信側Powerが0へ戻る問題を修正

REAL接続中に送信側コマンドが受信側でLOCKされ、その後のHOST_STATEで送信側UIが0へ巻き戻っていた問題を修正しました。

- Command sequence / ACKを追加
- ACK前の古いHOST_STATEで操作値を巻き戻さない
- REAL READY時は受信側でコマンドを実際の出力状態へ反映
- 受信側からACK後に確定状態を返す

### 4. 非アクティブ時は「出力停止」と「接続許可」を分離

タブ非表示・pagehide・heartbeat timeoutでは、接続許可を解除せず以下だけを行います。

1. 即ZERO
2. REAL REMOTE READYを解除
3. 状態をSUSPENDEDへ
4. 送受信の操作許可自体は維持

復帰後に再度ROOM申請/接続許可は不要です。ただしREAL出力は自動再開せず、受信側でREAL REMOTE READYを再ARMします。

### 5. 遠隔REAL出力を解禁

実COYOTEがREADYで、送信側が受信側から操作許可されているときだけ、受信側に `REAL REMOTE READY` が有効になります。

ARM手順:

1. 受信側で実COYOTEをREADYにする
2. ROOMを開始
3. 送信側を接続許可
4. A/B LIMITを確認
5. 受信側で `REAL REMOTE READY`
6. 必ずZEROから開始
7. 送信側がPower / Preset / PLAY / PAUSE等を操作

REAL出力は100ms周期B0です。

### REAL出力の強制停止条件

- E-STOP
- ALL ZERO / ZERO LOCK
- REAL REMOTE READY解除
- BLE切断
- Writeエラー
- 150ms超のスケジューラ遅延
- 受信側タブ非表示/pagehide
- 送信側タブ非表示/pagehide
- Remote lease timeout
- Role変更 / Permission変更
- 送信側の切断 / 受信側からのキック

停止時はZERO B0を複数回送信します。

## BLE接続

DG-LAB COYOTE V3:

- Device name: `47L121000`
- Service: `0x180C`
- WRITE: `0x150A`
- NOTIFY: `0x150B`
- B0: 20 bytes / 100ms
- BF: 7 bytes

接続診断では DEVICE / GATT / 180C / 150A / 150B / BF / ZERO / RAW error を確認できます。

## ROOMについて

現版のROOM通信はローカルQA用 `BroadcastChannel` です。同一オリジン/同一PCの複数タブで確認できます。
インターネット越しの WebRTC + Signaling は次フェーズです。

## 安全境界

- A/B LIMIT初期50%
- 受信側LIMITが常に最終上限
- E-STOPはラッチ式
- E-STOP解除後もZERO
- REAL ARM時は必ずZEROスタート
- タブ非表示時はZEROし、REAL自動再開なし
- reconnect時はZERO
- Viewerは書込不可
- HOLD BOOSTもLIMITを超えない
- HOLD TESTと遠隔REAL出力は同時使用不可
