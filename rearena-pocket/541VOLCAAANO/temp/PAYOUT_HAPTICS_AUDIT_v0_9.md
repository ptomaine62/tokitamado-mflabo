# HAPTIC KAZAAAN v0.9.1 — PAYOUT / HAPTICS FULL-CHAT AUDIT

この監査は、本チャットで初代KAZAAANを作り始めた時点からv0.8までに決めた「払い戻し = 刺激」のルールを再照合し、v0.9.1実装と比較したものです。

## 1. 絶対ルール

| ルール | v0.8 | v0.9.1 |
|---|---|---|
| 抽選結果は物理で決まり、刺激側が結果へ介入しない | OK | 維持 |
| 抽選中・UP移動中に予測刺激を出さない | OK | 維持 |
| 配当確定後にだけHAPTIC PAYOUTを開始 | OK | 維持 |
| `WIN = BET × 確定倍率` が刺激の総払い出し量 | OK | 維持 |
| 総WINが大きいほど刺激払い出し全体が長く/大きくなる | OK | 維持 |
| 1チャンクが大きいほど瞬間PowerとHARDNESSが上がる | **式がドリフト** | 初期確定式へ復元 |
| A/B LIMITは常に絶対上限 | OK | 維持 |
| PAYOUT終了後はOUTPUT ZERO | OK | 維持 |
| プレイヤーが払い出し中に刺激種類を選択しない | OK | 維持 |

## 2. 復元したチャンク式

### 通常払い出し

```text
base = clamp(round(sqrt(totalWIN) * 1.9), 8, 60)
chunk = round(base * random(0.85 .. 1.15))
```

v0.8では係数・上限が別値へ変化していました。v0.9.1で初期確定値へ戻しました。

### JACKPOT / SJP払い出し

```text
progress = delivered / totalWIN
lo = max(12, round(BET * 0.35))
hi = min(150, max(55, round(BET * 1.15)))
chunk = lerp(lo, hi, smoothstep(progress))
chunkは5単位へ丸める
```

後半ほど1回量が増える仕様を維持します。

## 3. Power / HARDNESS マッピング

```text
normal sizeNorm = chunk / 65
JP sizeNorm     = chunk / max(70, BET * 1.2)

hardness = 0.08 + 0.78 * sizeNorm^0.72
           + JP時 0.12 * progress

power = 10 + 78 * sizeNorm^0.68
        + JP時 8 * progress
```

どちらも0..100へクランプします。

重要: `power` は刺激プラン上のCommand Powerです。実際のA/Bはさらに各CHANNEL LIMITとON/OFFを通り、最終値を超えません。

## 4. 公式プリセットの相対HARDNESS順位

初期版で固定した「同一Channel Power/BF条件での相対負荷proxy」へ戻しました。臨床的な痛み尺度ではありません。

正規化後の重み:

```text
25% dose proxy
20% average Wave Strength / WIDTH
13% peak WIDTH
13% ON density
 9% high-WIDTH density
20% abruptness
```

順位を5帯へ分割:

```text
GENTLE / SOFT / SOLID / HARD / SEVERE
```

直近3プリセットには距離ペナルティ0.22を加え、目標HARDNESSに近い上位4候補からランダム選択します。これにより同じ波形だけを機械的に連打しません。

## 5. 時間構造

- 通常チャンク周期: 約0.50秒
- JP周期: 約0.42秒から後半へ少し短縮
- 各周期末尾: 約95msの明示的OUTPUT ZERO
- ON中はCOYOTE V3の100ms B0フレームを継続送信
- A/Bは同じプリセットを使い、B側はフレーム位置をずらして完全同時同形を避ける

v0.9.1ではグラフもこの実時間を25msごとにサンプリングするため、一定Power中でも停止して見えません。

## 6. DCB / HAPTICS PARTY系から取り込むもの・取り込まないもの

### 取り込む
- Command/Accumulationと瞬間Powerを混同しない表示
- A/Bの実効Powerをリアルタイム表示
- 4×25ms Frequency/WIDTHを流れる波形として表示
- Powerに応じて波形表示の明度を変える
- 現在の刺激名・強度・Hz・WIDTHを文字でも表示

### 取り込まない
- プレイヤーが払い出し中に刺激タイプを選ぶ操作
- LFO/連続/断続を手動選択するゲーム内操作
- HAPTIC ARENA固有のLEVEL/Resonance/Shop/Queue
- JOYHUB/DIMMER系の残響仕様

KAZAAANでは「配当そのものがCOYOTE刺激へ変換される」という単純さを優先します。

## 7. ダイヤボーナス

初期v0.1では8ダイヤの+20 CREDITにHAPTIC PAYOUTを付けていませんでした。一方、現在の設計原則は「実際に払い戻されるメダル/クレジットを刺激払い出しとして扱う」です。

v0.9.1では **ダイヤ完成ボーナスも確定払い戻しなのでHAPTIC PAYOUT対象** として統一しています。ただしダイヤ0..8の内部抽選分布自体は公式表が未確認のため再現モデルです。

## 8. 未確認・推定として残すもの

- `×?` のSEGA内部P/Oテーブル
- ダイヤ0..8の厳密な振り分け
- 公式プリセットの人体体感を絶対値へ変換する尺度

これらは「公式確定値」と表示せず、独立したモデルとして扱います。

## 9. v0.9.1で見つけて修正したドリフト

1. 通常チャンク係数/上限が初期基準から変わっていた → 復元
2. JPチャンク係数/上限が初期基準から変わっていた → 復元
3. Power/HARDNESS正規化式が変わっていた → 復元
4. 波形HARDNESSランキングの特徴量・重みが変わっていた → 復元
5. グラフ履歴が`setOutput()`時しか進まず、一定出力中に停止して見えた → 25msリアルタイムサンプリングへ変更
6. 現在の刺激種類・A/B実効強度・Hz・WIDTHが一目で分からなかった → 常時テキスト表示を追加

以上をv0.9.1の基準とします。
