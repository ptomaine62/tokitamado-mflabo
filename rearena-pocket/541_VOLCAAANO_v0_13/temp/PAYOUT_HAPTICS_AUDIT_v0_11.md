# 541 VOLCAAANO!!! v0.11 — PAYOUT / HAPTICS AUDIT

## 1. 通常払い出し

基本CHUNK式はv0.9で復元した基準を維持します。

```text
base = clamp(round(sqrt(totalWin) * 1.9), 8, 60)
chunk = round(base * random(0.85 .. 1.15))
```

v0.11では枚数の節目を追加しました。

- totalWin < 100: milestone = 10
- totalWin >= 100: milestone = 100

CHUNKが次のmilestoneを飛び越えそうな場合は、その節目でCHUNKを分割します。
そのため60枚なら10/20/30/40/50枚、360枚なら100/200/300枚の実到達点でZERO区間になります。

区切り時間:
- 10枚: 0.14秒
- 100枚: 0.22秒

通常のCHUNK間ZERO 0.095秒より長いので、区切りを体感で数えられる設計です。

## 2. SJP

SJPは通常払い出しと同じ枚数保存則を守りながら、別格の長時間エンベロープを使用します。

### Power / HARDNESS
- 開始時Power floor: 78%
- 終了時Power floor: 100%
- 開始時HARDNESS floor: 0.72
- 終了時HARDNESS floor: 1.00
- FINALE Power floor: 95%→100%
- FINALE HARDNESS floor: 0.96→1.00

### 時間
- ブロック内ON: 約0.72秒 → 0.64秒
- ブロック内ZERO: 約0.032秒 → 0.008秒
- ブロック境界: 約0.60秒 → 0.22秒
- FINALE ON: 約0.70秒
- FINALE ZERO: 約0.004秒

これによりv0.10の「強いが通常より短く終わり得る」問題を解消しています。

## 3. 代表比較

同じ総払い出し量を通常式で処理した代表値（jitter=1.0）との比較:

| BET | SJP総量 | SJP | 同量通常 | 判定 |
|---:|---:|---:|---:|---|
| 5 | 500 | 約17.3秒 | 約8.1秒 | SJP長い |
| 10 | 1000 | 約34.7秒 | 約11.2秒 | SJP長い |
| 30 | 3000 | 約92.4秒 | 約33.7秒 | SJP長い |
| 50 | 5000 | 約116.7秒 | 約56.2秒 | SJP長い |
| 99 | 9900 | 約121.8秒 | 約111.4秒 | SJP長い |

SJPは長時間化しても、ブロック内ZEROは短いままなのでDutyが高く、通常払い出しより刺激密度も高い状態を維持します。

## 4. LIMIT

ゲームCommand 0..100%をLIMIT内へ比例変換します。

```text
effective = command * limit / 100
```

最後に0..limitへクランプします。

## 5. 名称

UI上のゲーム名は `541 VOLCAAANO!!!`。
UI上の機器名は `E-STIM DEVICE`。

DG-LAB COYOTE V3という名称は、BLE UUID・公式波形ソース・技術監査など、実プロトコルを指す文脈では保持します。
