# 541 VOLCAAANO!!! v0.11

初代 `100&メダル KAZAAAN!!` の公開資料・当時記事・攻略記録・実機動画を照合しながら再構築した、物理抽選＋E-STIM DEVICE HAPTIC PAYOUT試作です。

## 起動
1. ZIPを展開します。
2. `index.html` を Chrome / Edge で開きます。
3. SIMのままゲームと刺激表示を確認できます。
4. 実機を使う場合は `REAL` → `CONNECT`。

## v0.11 — COUNTABLE PAYOUT / LONG SJP / BRAND RENAME

- ゲーム名を **541 VOLCAAANO!!!** に変更。
- UI上の `COYOTE` 表記を **E-STIM DEVICE** に変更。内部のDG-LAB COYOTE V3 BLEプロトコル名・公式波形ソース名は技術上そのまま維持。
- 通常払い出しに枚数区切りを追加。
  - 総払い出し100枚未満: **10枚ごと**にZERO区間。
  - 総払い出し100枚以上: **100枚ごと**にZERO区間。
  - チャンクは節目を飛び越えず、10/100枚の実到達点で区切る。
  - 区切りは実払い出し量を分割するだけで、架空の刺激・架空のメダルは追加しない。
- SJPはv0.10より大幅に長時間化。
  - SJP内Power/HARDNESSの高い専用エンベロープは維持。
  - ブロック内刺激ONを約0.72→0.64秒へ延長。
  - FINALE ONは約0.70秒。
  - ZEROは短いままなので高Dutyを維持。
  - SJPブロック境界は明確な無出力区間を維持。
- 同じ払い出し枚数を通常式で処理した代表値より、SJPの総刺激時間が短くならないことを検証。
  - BET5 / 500: SJP 約17.3秒 > 通常 約8.1秒
  - BET10 / 1000: SJP 約34.7秒 > 通常 約11.2秒
  - BET30 / 3000: SJP 約92.4秒 > 通常 約33.7秒
  - BET50 / 5000: SJP 約116.7秒 > 通常 約56.2秒
  - BET99 / 9900: SJP 約121.8秒 > 通常 約111.4秒

## LIMIT

LIMITは「設定値を実機側100%とする比例変換」です。

例: A LIMIT 30%
- Command 25% → 実効 7.5%
- Command 50% → 実効 15%
- Command 80% → 実効 24%
- Command 100% → 実効 30%

最後にLIMITで絶対クランプされるため、設定上限を越えません。

## 重要な設計原則

- BETと発射タイミングだけをプレイヤーが決める。
- 発射後のゲーム結果は物理演算で決定する。
- 抽選中にE-STIM出力で結果を予測・誘導しない。
- 結果確定後だけHAPTIC PAYOUTを開始する。
- 総WIN = 総刺激払い出し量。
- 通常払い出しはCHUNK量でPower/HARDNESSを決める。
- SJPは長時間・高Power床・高HARDNESS床・ブロック・FINALEを持つ別格エンベロープ。
- LIMITは常に最終絶対上限。

## 検証

- `verify_kazaaan.js`: 基本ルール・物理・BLEパケット監査
- `verify_v09_additions.js`: UP遷移・リアルタイム刺激表示・LIMIT監査
- `verify_v011_payout.js`: 10/100枚区切り・SJP長時間化・名称監査
- `VERIFICATION_v0_11.txt`: 上記結果を統合
- `PAYOUT_TIMING_SAMPLES_v0_11.txt`: 代表的な払い出し時間一覧

物理実機と電極を用いた触覚そのものの検証は、この環境では実施していません。
