# SHOCKiG REARENA POCKET
# DICE CHARGE BATTLE

Version: 20260605-01

## 概要

DICE CHARGE BATTLEは、スマホ1台と対応BLE低周波デバイス1台で遊ぶ、2人用のローカル対戦Webアプリです。

P1はチャンネルA、P2はチャンネルBに割り当てます。

## 起動方法

Cloudflare Pages等のHTTPS対応静的ホスティングへ以下のファイルを配置してください。

- index.html
- app.js
- style.css
- manifest.webmanifest
- README.md
- assets/logo.svg

Web Bluetoothを使用するため、HTTPS環境が必要です。

## Access Code

購入者向けAccess Code:

DCB-MFLABO-202606

Access Code未認証ではゲームへ進めません。

## 安全上の注意

本アプリは低周波BLEデバイスを制御します。

- 必ず低い出力から開始してください。
- 体調不良、違和感、痛み、しびれ等を感じた場合は直ちに使用を中止してください。
- 心臓疾患、医療機器、ペースメーカー等に関係する方は使用しないでください。
- 画面非表示、通信切断、送信エラー、緊急停止時は出力0%になります。
- A/Bチャンネルテスト完了まではゲームを開始できません。
- 使用は自己責任で、同意できる場合のみ起動してください。

## 対応環境

推奨:

- Android Chrome
- Web Bluetooth対応ブラウザ
- HTTPS配信

iPhone / iPadではWeb Bluetooth対応状況に制限があります。確認モードではBLEなしで画面・音・ゲーム進行を確認できます。

## ゲームルール

1. P1がダイスを振ります。
2. P2がダイスを振ります。
3. 出目が小さい側にChargeが加算されます。
4. Chargeに応じて該当チャンネルの出力ゲージが動きます。
5. 規定ラウンド終了時にChargeが少ない方が勝利です。
6. 同点の場合はサドンデスです。

## 初期設定

- ラウンド数: 10
- 出目差チャージ: 出目差 × 5
- あいこチャージ: 両者 +3
- 継続出力: ON
- 継続ON: 500ms
- 継続OFF: 1500ms
- 精算イベント: ON
- 精算カウント: 3000ms
- 精算ボーナス: 5%
- 精算時間: 900ms
- 最終精算カウント: 3000ms
- 最終精算ボーナス: 8%
- 最終精算時間: 2000ms

## 確認モード

「低周波デバイスなし確認モード」を選ぶと、実機へBLE送信せず、画面・音・ゲーム進行・出力ゲージのみ確認できます。

## PWA

manifest.webmanifestにより、スマホのホーム画面へ追加できます。

初期販売版ではService Workerを使用しません。

理由:

- 安全修正を即時反映するため
- app.js / style.css の古いキャッシュ残留を避けるため
- SAFE STOP修正を確実に届けるため

## 更新時の注意

index.html内のバージョンクエリを変更してください。

例:

```html
<link rel="stylesheet" href="./style.css?v=20260605-02">
<script src="./app.js?v=20260605-02"></script>
<link rel="manifest" href="./manifest.webmanifest?v=20260605-02">
