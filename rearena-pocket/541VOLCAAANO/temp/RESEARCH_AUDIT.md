# HAPTIC KAZAAAN — 実機再調査 / 累積差異監査（through v0.8）

更新: 2026-08-26

## 結論

v0.1 の最大の問題は、KAZAAAN の物理を「円形ボウルの中を球が渦巻いて穴へ吸い込まれるゲーム」として作っていた点です。実機は、**モーターで回転するクルーンのポケット列に対して、発射された球が曲面レール上を左右に往復しながら減衰し、ポケットの縁・入口・固定部品との接触で軌道が変化して落下する**タイプです。

また実機は1段ごとの画面切替ではなく、**火山状に積層された1段目・2段目・3段目が常時同じ筐体上に見え、UPすると固定スロープで上段へ運ばれる**構造です。JPCではさらに球が中央を上昇し、天井の大型ルーレットへ移動します。

v0.2ではこの前提から作り直しました。v0.1の物理コードは継承していません。

---

## 主要な一次・準一次資料

### SEGA 公式 初代KAZAAAN
- https://kazaaan.sega.jp/1stkazaaan/
- 公式で確認できる事項:
  - 3段クルーン、完全物理抽選
  - メダル投入 → BET → 黄色ボタンでボール発射
  - UPで固定スロープを通り上段へ、OUTで終了
  - 配当穴と「?」
  - 3段目HOLD、JACKPOT CHANCE
  - JPC後はHOLD球が全部ではなく1球だけ回収
  - 天井ルーレット、SJP最大100倍 / 99BETで9900
  - ダイヤ8灯の表示とダイヤボーナス

### SEGA公式画像（構造確認に使用）
- 操作盤: https://kazaaan.sega.jp/1stkazaaan/images/play_r_img.jpg
  - 赤色LEDのMEDAL/BET表示、緑のBET操作、黄色のSTART、右側の発射レールを確認。
- 3段積層: https://kazaaan.sega.jp/1stkazaaan/images/cln_img.jpg
  - 1・2・3段目が同じ火山筐体に積層、UPスロープが実物として存在。
- UP/OUT: https://kazaaan.sega.jp/1stkazaaan/images/cln_l_img_1.jpg
  - 丸穴ではなく、壁を持つポケット/ゲート状入口。
- 3段目JPC: https://kazaaan.sega.jp/1stkazaaan/images/cln_img2.jpg
- 天井JPC: https://kazaaan.sega.jp/1stkazaaan/images/jp_img.jpg
- HOLD状態: https://kazaaan.sega.jp/1stkazaaan/images/point_2_img.jpg
- ダイヤ8灯: https://kazaaan.sega.jp/1stkazaaan/images/point_1_img.jpg

### GAME Watch（2010 AMショー実機紹介）
- https://game.watch.impress.co.jp/docs/news/392886.html
- 重要な記述:
  - 当時として珍しく液晶画面を搭載しない。
  - 回転するクルーンのタイミングに合わせてボールをシュート。
  - 球は「ふらふらと左右にゆれつつ」UPへ入る。
  - スローモーでアナログな「たゆたう」テンポ。

### 第48回 Amusement Machine Show
- https://am-j.co.jp/column/48amshow/info01.html
- 火山をモチーフにクルーンを使い、タイミングを計って発射するゲームとして紹介。

---

## 同時代攻略資料

### メダルゲームはじめました / KAZAAAN
- https://medalgame.turigane.com/kazaaan.html
- BET 5～99。
- 発射ボタンから球発射まで 0～約2秒の遅延。
- UPはOUTより狭い。
- 球は2～3回以上の「往復」を行い、入口壁への接触で往復回数が変わる。
- 1・2段目は回転速度変化が存在。後期/対策ROMでは攻略へ大きく影響。
- 1段目: UP×6 / OUT×12 = 18。
- 2段目: 15ポケットの明示配列。
- 3段目: JPC / ×3 / ×6 / ×? / ×6 / ×3。
- 3倍・6倍はHOLD、4球HOLDでJPCか?だけになる。
- JPCでHOLDを1球解除。
- 天井下段: SJPC / ×6 / ×12 / ×? / ×12 / ×6。
- 天井上段: SJP×100 / ×15 / ×30 / ×? / ×30 / ×15。
- 「?」は単純一様乱数ではなく、台状態やHOLD配置と関係するという観測。

### Nine-o-clock Blog（2010）
- https://ameblo.jp/nine-o-clock-22233222000/entry-10733629816.html
- ?倍率レンジやP/O・台状態との関係を観察。
- 注: 2段目ポケット数について別記事/記述に12穴と読める情報があり、他資料の15穴と矛盾するため、2段目個数の単独根拠には採用しない。

### Wikipedia（集約資料。一次資料ではない）
- https://ja.wikipedia.org/wiki/100%26%E3%83%A1%E3%83%80%E3%83%AB_KAZAAAN!!
- 2段目15ポケットの内訳が、同時代攻略ページの明示配列と一致。
- ダイヤチャレンジ: 10BET以上の対象OUT、最大8ダイヤ、8個でボーナス（枚数は店舗設定）。

---

## YouTubeで照合対象にした動画

検索・照合対象として以下を確認しています。

- 「【メダルゲーム】カザーンをプレイしてみた」
  https://www.youtube.com/watch?v=7UfuMobTb_g
- 「初代カザーン通常プレイ #11」
  https://www.youtube.com/watch?v=f1T-VGfWMFI
- 「初代カザーン通常プレイ #24」
  https://www.youtube.com/watch?v=5IKAqOfIIDA
- 「【メダルゲーム】カザーンに100回挑戦したらUPに入りやすい…」
  https://www.youtube.com/watch?v=A84OUkb0rjQ
- 「セガメダルゲーム KAZAAAN！攻略 ｜ カザーン」
  https://www.youtube.com/watch?v=Kf08fKfkFO0
- 初代/激の比較・攻略動画群（2段目狙い、99BET、低速時攻略など）も検索対象。

**重要:** この環境ではYouTube本体の自動取得がthrottleされることがあり、全動画をフレーム単位で直接計測できません。そのため、動画だけに依存する寸法・秒数・衝突係数は「確認済み仕様」として固定せず、公式画像・同時代記事・攻略記録と複数一致した挙動だけを再現要件に採用しました。動画フレームを見ていないのに「完全一致」とは扱いません。

---

## v0.1 → v0.2 差異

| 項目 | v0.1 | 実機資料 | v0.2 |
|---|---|---|---|
| 空間構造 | 1段ずつ別の上面円盤 | 3段火山が同時に見える | 3段＋天井を同一Canvasに常時表示 |
| 球運動 | 中心へ渦巻く2Dボウル | 左右に往復・減衰・縁で軌道変化 | 曲面レールの減衰往復モデルへ全面変更 |
| ポケット | 円形穴 | 壁を持つゲート/ポケット | 回転ポケット帯＋入口幅・縁衝突 |
| UP | シーン切替 | 固定スロープを球が上る | 球をスロープ上で移送表示 |
| 回転 | 球へ旋回力を付与 | クルーン自体がモーター回転 | 球とポケット帯を独立運動 |
| 発射タイミング | 影響が弱い | 唯一の重要操作 | 待機中もクルーン位相を進め、押した瞬間の位相を使用 |
| 発射遅延 | 0～2s | 0～約2sの観測 | 維持。ただし結果先決めなし |
| UP幅 | 円穴を少し小さく | OUTよりUPが狭い | 角度方向の実効入口幅を狭く設定 |
| HOLD | 穴フラグだけ | 実球がポケットに残る | HOLD球を物理障害として描画・衝突 |
| JPC | 普通の別円盤 | 中央から天井大型ルーレットへ | 天井機構へ実球を移送、上下2段を分離 |
| 操作盤 | ゲーム風UI | LED＋BETボタン＋黄色START | 公式写真を参考に機能配置を再構成 |
| 液晶 | 大きなゲーム画面感 | 実機は液晶非搭載 | Canvasは筐体そのものの可視化として扱い、操作UIは機械風 |
| ?倍率 | 範囲内一様乱数 | P/O・台状態依存の観測 | 一様乱数を廃止。独立した推定モデルとして隔離 |
| ダイヤ | 単純乱数 | 10BET以上の対象OUT、8灯 | 8灯・店舗設定BONUSを実装 |

---

## 「確定」と「推定」を分離した部分

### ほぼ確定として実装
- 5～99BET。
- 1段目18、2段目15、3段目6のポケット構成。
- 3段目HOLD対象と、JPC時1球解除。
- JPC/SJPCの6ポケット構成と倍率レンジ。
- SJP ×100。
- 発射後はゲーム操作なし。
- 発射遅延があり得る。
- 球が左右に往復する。
- クルーンが球とは独立して回転する。
- UPがOUTより狭い。
- UP後は固定スロープで上段へ。
- JPC後は天井ルーレットへ。

### 公開情報だけでは完全確定できないため、推定モデルとして分離
- ROMごとの正確なモーター速度テーブルと速度変更タイミング。
- 球・レールの摩擦係数、傾斜角、反発係数、各サテライト固有のクセ。
- 各「?」の内部P/Oテーブル。
- ダイヤ0～8個の正確な内部確率。
- HOLD配置ごとの厳密なJPC実入賞率。

これらは `js/kazaaan-data.js` / `js/kazaaan-physics.js` の調整可能なブロックへ隔離し、未確認値を「SEGA公式値」としてハードコードしない設計にしています。

---

## COYOTE側

KAZAAANのゲーム挙動とCOYOTE出力を分離しています。ゲーム結果は純粋に物理エンジンで決まり、COYOTEは確定配当を受け取ってからHAPTIC PAYOUTを行います。

- 小払い出し: 低Power＋相対負荷が低い公式プリセット帯。
- 大払い出し: 1回の払い出し量に応じてPowerとプリセット負荷帯が上昇。
- SJP: 総量が大きいだけでなく、進行に伴って1回の払い出し単位も大きくなる。
- 最終LIMITは常にCOYOTE出力の絶対上限。
- 波形順位はPowerを除外し、rawの平均/RMS/ピーク波形強度、ON密度、急変量、周波数密度の代理値から相対化。
- これは医学的な「痛み順位」ではなく、同じPower/BFで比較した相対刺激負荷インデックス。

---

# v0.3 追加監査 — 固定入口・公転ポケット・UP連続移送

更新: 2026-08-26

## 今回の再確認ポイント

ユーザーテストで、v0.2には次の違和感が残っていると判明した。

1. ポケットの位置が公転するだけでなく、ポケット矩形そのものまで回転して見える。
2. 実機は球が左右に転がった後、中央付近の固定された入口/隙間を通り、その時そこへ来たポケットへ入るように見える。
3. UP後、スロープを登った球が上段抽選開始時に別位置へワープして見える。

この3点を改めて資料と突き合わせた。

## 一次資料・当時記事との整合

### SEGA発表文 / 4Gamer 2010-11-29
https://www.4gamer.net/games/124/G012494/20101129021/

メーカー発表文には、発射されたボールは「専用クルーンに向かってレールを移動」、UPに入ると「スロープを伝ってボールが上段へ移動」とある。したがって、UP後に球を消して上段中央へ再生成する方式は実機表現として不適切。

### GAME Watch 2010 AMショー
https://game.watch.impress.co.jp/docs/news/392886.html

「回転するクルーンのタイミングにあわせてボールをシュート」「ふらふらと左右にゆれつつ」という実機観察がある。球そのものがポケット列と一緒に円周を周回するモデルより、固定側の往復軌道と独立回転クルーンの組合せが整合する。

## 同時代攻略記録との整合

### メダルゲームはじめました / KAZAAAN
https://medalgame.turigane.com/kazaaan.html

- 発射遅延 0～約2秒。
- 球の「往復回数」を攻略指標にしている。
- 「入口の壁に引っ掛かり」往復回数が変化するとの記録。
- 1・2段目の回転速度変化を記録。

固定側に入口・壁があり、そこへ回転ポケットが来るモデルと整合する。

### Nine-o-clock Blog 2010
https://ameblo.jp/nine-o-clock-22233222000/entry-10733629816.html

- UPポケットはOUTより入りにくい構造・領域と記述。
- ポケットへの傾斜、球が完全に入り切るまでの時間差、UPを跳ねのけられて次のOUTへ外れる現象を記録。
- 2段目以降も台ごとの球運動・抽選時間に癖があると記録。

従って、ポケットを単なる判定ラベルにせず、入口幅・位置ずれ・縁衝突を物理判定へ残す。

### J-L-T 激カザーン攻略（後継機。機構ファミリーの補助資料）
https://ameblo.jp/juniorleadertake/entry-12052736017.html

後継の激KAZAAANについて、球の往復回数、複数のクルーン回転速度、UP/OUTの入口構造差、高速時のUP弾き、穴の角への衝突で軌道が大きく変わることを記録。初代そのものの一次資料ではないため数値は流用しないが、KAZAAAN系の物理機構理解を補助する資料として扱う。

## 2段目・3段目について

公開されている内部断面図は見つかっていないため、「1～3段目すべてが完全に同一寸法のスリットを使う」とは断定しない。

ただし、以下から少なくとも同じ**固定側を往復する球＋独立して回るポケット＋入口/縁で軌道が変わる**抽象モデルで扱うことが妥当と判断した。

- 2段目も攻略で往復・傾斜・速度変更・ポケット角による急減速が観察されている。
- 3段目も単純確率ではなく、HOLD位置や台固有の「粘る軌道」「手前HOLDへ入りやすい」「HOLD球を乗り越える」といった実球軌道の偏りが記録されている。
- 公式写真では3段が同一の火山筐体上に積層した物理クルーンとして構成されている。

v0.6では1～3段目に同じ原理の固定入口モデルを使い、段ごとにレール半径・入口有効幅・自然振動・減衰・傾向を別パラメータにしている。

## v0.6実装方針

### ポケット表示
- 各ポケットの中心位置はモーター位相に従って公転。
- ポケット矩形/文字は自転させない。
- 前後位置はサイズ変化だけで表現。

### 固定往復レールと入口
- 1～3段目の球は固定レール上を左右に往復。
- レール中央付近に実際に描画上も切れた固定ギャップを設置。
- ポケットキャリアはその下を独立公転。
- ギャップ通過時に直下のポケット入口が十分整列していれば落下方向へ進む。
- ずれている、HOLDで塞がれている、入口が狭い場合は縁衝突として次の往復へ戻す。
- 結果を事前抽選してアニメーションを合わせる処理は使用しない。

### 落下しやすさ
球は往復を重ねて運動エネルギーを失うため、`settle`状態を物理状態として蓄積する。これにより初期の高速通過では縁に弾かれやすく、十分減衰してポケット中心と一致すると落下しやすくなる。これは結果を選ぶ乱数ではなく、現在の運動・位相・入口整列から決まる。

### UP後
- 入賞位置 → 固定スロープ口 → 上段レール入口を一つの連続軌道で描画。
- transfer終点と次段physicsの`entryPoint`を同一座標にする。
- 上段開始時に中央へ再生成しない。

## 未確定として残すもの

- 固定入口/スリットの厳密な実寸・断面形状。
- 1、2、3段目それぞれの入口形状の微細な差。
- 実機固有のネカセ、摩擦、球径公差、汚れによる差。
- ROM/サテライト別の正確なモーター速度変更ロジック。

これらは今後より鮮明な実機動画・保守資料・内部写真が得られた場合に差し替える。現時点では未確認値を公式仕様とは表記しない。


## v0.6追加挙動

- ポケット間の暗いキャリア面は「空間」ではなく、ポケット開口部以外を塞ぐ固体面として処理する。固定入口へ来ても直下がポケット開口でなければ球を反発させ、落下途中に開口がずれた場合も押し戻す。
- 入賞判定後は球を即座に削除せず、約0.90秒間、捕捉したポケット中心を追従させる。これにより「入った瞬間に消える」表現を廃止する。
- ポケットの遠近表現とラベル可読性を分離する。ポケット本体は前後位置で拡大縮小するが、ラベルは全段共通12pxのスクリーンスペース描画とする。

これらはゲームルール変更ではなく、既存の固定入口＋公転ポケットモデルを視覚・衝突挙動として一貫させるための修正。

## v0.6 focused re-check: launch lag and pocket lips

### START -> ball release

Two contemporaneous strategy sources independently describe a machine-controlled random delay between pressing the launch button and the ball actually being released. One explicitly gives the range as 0 s to about 2 s; another states that a short case can release essentially at the button press while a long case can be roughly 2 s late.

Sources:
- https://medalgame.turigane.com/kazaaan.html
- https://ameblo.jp/nine-o-clock-22233222000/entry-10733629816.html

SEGA/GAME Watch descriptions simplify the player-facing operation to pressing the button and launching/shooting a ball; they do not publish the internal delay probability table.
- https://game.watch.impress.co.jp/docs/news/376847.html
- https://game.watch.impress.co.jp/docs/news/392886.html

Conclusion: retaining a random 0–about-2-second release lag is supported. The old uniform distribution was not supported by evidence and made the machine feel as if it always hesitated. v0.6 therefore preserves the documented range but biases the emulation toward short delays. This distribution is explicitly an emulation parameter, not an asserted SEGA table.

### Pocket/lip geometry

Period photographs show individual pockets separated by raised physical dividers around the rotating carrier. Contemporary strategy descriptions also refer to balls striking pocket corners/entrance walls, UP being physically narrower, and correctly timed balls being knocked away by the pocket structure. These observations are more consistent with discrete cavity + solid-lip contact than with a smooth angular acceptance zone followed by an artificial side impulse.

Sources:
- https://www.4gamer.net/games/124/G012494/20101129021/
- https://game.watch.impress.co.jp/docs/news/392886.html
- https://medalgame.turigane.com/kazaaan.html
- https://ameblo.jp/nine-o-clock-22233222000/entry-10733629816.html

The exact SEGA CAD profile/section dimensions remain unavailable. v0.6 therefore models the carrier as gear-like cavities and teeth for collision purposes without claiming that the original component is literally a mathematical gear.


## v0.6 unified carrier contour revision

ユーザー確認で、v0.5の「穴」と「歯車」の間に視覚上の隙間があり、描画形状と当たり判定が一致していないように見える問題を再検討した。コード監査でも実際に、v0.5は次の3系統が独立していた。

1. ポケット表示: 角丸矩形を公転させる
2. 歯表示: ポケット間に放射線を描く
3. 物理判定: `sector × slot.width × 0.78` の角度領域

この分離は、見た目では穴なのに物理では歯、あるいは見た目では隙間なのに物理では空洞、という不整合を起こし得る。

v0.6では `cavityGeometry(stageId,index)` を唯一の幾何定義とし、以下を同一データから生成する。

- ポケット開口の左右境界
- ポケット底の半径位置
- ポケット間の固体歯/仕切り
- 固定ゲート直下での cavity/tooth 判定
- 落下途中にポケットが逃げた場合の側壁衝突
- 入賞可能な球中心の有効幅
- 描画上のポケット輪郭
- DIAGNOSTICSのHITBOXオーバーレイ

公開されている実機写真では、1～3段目のポケットは独立した浮遊矩形ではなく、回転クルーンの連続した区画として見える。SEGA公式は専用クルーンによる完全物理抽選であることを説明している。

References:
- https://kazaaan.sega.jp/1stkazaaan/
- https://www.sega.jp/history/arcade/product/7937/
- https://www.4gamer.net/games/124/G012494/20101129021/
- https://medalgame.turigane.com/kazaaan.html
- https://ameblo.jp/nine-o-clock-22233222000/entry-10733629816.html

正確なSEGA部品CAD断面は未確認のため、ポケット深さ・歯厚の絶対寸法は再現値であり公式値とはしていない。ただしv0.6では、少なくとも**画面上の輪郭とシミュレーション上の輪郭は同一**である。


## v0.7: pocket-seating / local-offset revision

ユーザー試験で、v0.6でも同じ固定位置で複数回弾かれること、見た目の開口と実際の判定にまだ差があるように感じること、そして「マスに入った後は中心へ吸わず、そのマス内の位置を維持した方が自然ではないか」という指摘があった。

コード監査では2点を確認した。

1. v0.6は描画開口 `cavityHalf` に対して、球中心の捕捉判定だけ `BALL_ANGULAR_MARGIN_RATIO` を引いた `captureHalf` を使っていた。このため同一輪郭化後にも、目視上は穴なのに内部では歯扱いになる細い帯が残っていた。
2. 球がかなり穴へ沈んだ後も、最終captureまでは固定入口直下との整合を要求し続けていた。ポケットが回転して入口から離れると、既に凹部へ入りかけた球まで側壁衝突で押し戻され得た。

v0.7では以下へ変更した。

- `inCaptureCavity = inVisibleCavity` とし、描画開口と物理開口を一致させる。
- 球が固定入口を通過し、開いているポケット内へ `CAVITY_ENGAGE_SCALE` まで沈んだ時点で `engaged/SEATED` 状態に移行する。
- SEATED後はポケット中心からの相対位置 `captureLocal` を保持し、その区画と一緒に公転する。中心への吸着は行わない。
- SEATED後は固定入口の位置がずれても、その理由だけで球を穴から排出しない。
- 歯/暗い面との衝突後は、同一浮動小数点境界へ直ちに再接触しない程度だけ輪郭から解放する。これは結果誘導ではなく数値チャタリング防止。

500回の1段目決定論的試験では、平均dark/tooth bounceは約3.3回、即時同一接触ストリーク最大2。捕捉時の相対位置は平均約0.068 rad、最大約0.109 radで、中心0への強制吸着ではないことを確認した。

### 実機根拠と限界

SEGA公式/公開実機写真では、ポケットは回転体の連続した区画・凹部として見える。GAPOLI/激KAZAAAN系のルール写真でもUP/OUT/倍率ポケットに奥行きのある区画と仕切りが確認できる。これらは「一度凹部へ十分に落ちれば、その回転区画に運ばれる」モデルと整合する。

ただし、初代KAZAAANのポケット内部CAD、球保持深さ、側壁角度、球径に対する正確なクリアランスは未入手である。したがって `CAVITY_ENGAGE_SCALE` と内部沈み込み速度は再現値であり公式値ではない。

References:
- https://kazaaan.sega.jp/1stkazaaan/
- https://portal.gapoli.net/game/
- https://medalgame.turigane.com/kazaaan.html


---

## v0.8: BALL / POCKET full reverse-audit

ユーザーから「廃止した処理の残骸」と「球と穴の処理自体」を再監査する要望を受け、`js/kazaaan-physics.js` だけでなく `app.js`・描画・診断・検証コードまで逆方向に追跡した。

### 実際に見つかった問題

1. **固定入口の二重幅**
   - 物理: `gateHalfTheta`
   - 描画: `visualGap` と独立した矩形 `slitW/slitH`
   - 同じ入口に見えても、画面上の切れ目と物理上の有効範囲が大きく異なっていた。

2. **穴判定を球位置ではなく入口中央でサンプリング**
   - `carrierGeometryAtGate()` は固定入口中央の1点だけを見ていた。
   - 球が入口左/右端にいるのに中央直下の穴を使って `open` と判断でき、斜め横から穴へ入るように見える原因になった。

3. **旧衝突解放処理が結果に影響**
   - `releaseFromCarrierContact()` が衝突時に球の `theta` を一定量ずらし、横速度へ最低値を与えていた。
   - 数値チャタリング防止の意図だったが、物理的には隠れた横キック/位置補正であり撤去対象と判断。

4. **時間依存の解決補助**
   - `settle`
   - `timeBias`
   - 15秒以降の強制的な radial 減少
   - 10秒以降に増える中心復元力
   これらは結果を事前選択してはいないが、「長引いたから穴へ寄せる」補正なので純粋な形状・速度モデルから除外した。

5. **SEATED直前の相対位置クランプ**
   - `captureLocal` を cavityHalf の82%以内へ寄せていた。
   - 中心0への吸着ではないが、ユーザーが求めた「入った位置をそのまま保持」とは一致しないため削除。

6. **JPC/SJPCの描画と物理が別系統**
   - 描画は角丸矩形、物理幅は別係数だった。
   - v0.8では全5段を `cavityGeometry()` へ統一。

7. **球が点質量扱い**
   - v0.7は見えない二重判定を消すため `ballMargin:0` としたが、結果として画面上の球半径が物理へ反映されず、球が穴壁へめり込んで見える余地があった。
   - v0.8では描画球と同じ基準 `BALL_RADIUS_NORM=.010` から角度方向の球半径を算出する。水色の実壁に対し、黄色デバッグ線は「球の外周が壁に接触したときの球中心位置」であり、任意に狭めた第二ヒットボックスではない。

8. **app.jsに廃止済み関数呼び出しが残存**
   - 診断更新が `carrierGeometryAtGate()` を呼び続けていた。
   - 物理クラスから既に削除した後は実行時エラーになり得た。球直下の `carrierProfile()` と `gateGeometry()` に置換。

### v0.8の現在の判定順序（1ST～3RD）

1. 球は固定レール上で減衰往復する。
2. 球中心が `gateGeometry()` の可視固定入口内へ入る。
3. **その球中心の真下**を `carrierProfile(stageId, t.theta)` で評価する。
4. 球半径を含めても cavity 内なら下向き加速度を受ける。
5. 歯/暗い上面なら carrier top で受け止められる。横方向への隠れたキックはない。
6. cavity 内を十分な深さまで下りたら SEATED。
7. SEATED時の `captureLocal` をそのまま保持し、以後固定入口との再整列判定をしない。
8. 0.20秒の内部沈み込み後に capture event。画面ではさらに0.90秒ポケットと一緒に見せてからゲーム処理へ進む。

### 検証

- Node.js構文検査: 全JS PASS
- app.js -> physics method call 静的照合: 未定義呼び出し 0
- `verify_kazaaan.js`: **64/64 PASS**
- 追加モンテカルロ:
  - 1ST 1000: unresolved 0
  - 2ND 1000: unresolved 0
  - 3RD 1000: unresolved 0
  - 3RD 4-HOLD 700: unresolved 0 / ×3・×6 capture 0
  - JPC 500: unresolved 0
  - SJPC 500: unresolved 0
- 1ST 1000球で同一接触ストリーク最大1
- 500球の追加試験で radius-aware cavity wall 外へSEATEDした球 0
- 高速carrier接触で隠れた横方向即時反転 0

### 残る近似

- 2D楕円断面であり3D剛体シミュレーションではない。
- ポケット壁は角度方向の直線的な区画として近似。実機の歯先R/壁の丸み/深さのCAD値は不明。
- 球のスピン、転がり摩擦、3D法線、微小な筐体振動は未モデル化。
- `CAVITY_ENGAGE_SCALE` と `CAVITY_ENGAGE_SETTLE` は「いつからマスに完全保持されたとみなすか」の再現値で公式値ではない。
- JPC/SJPCの詳細な天井内部軌道は1～3段目より公開資料が少なく、同じ共有輪郭へ統一したものの形状確度は低い。

したがってv0.8時点で言えるのは、**旧処理の残骸・描画/判定の内部矛盾はコード監査上解消した**ということであり、「実機の3D CAD形状まで完全一致した」という意味ではない。

---

## v0.9追加監査 — UP / PAYOUT / TELEMETRY

### UP入賞の特殊処理
`js/kazaaan-physics.js`を再検索した結果、物理計算中に `slot.type === 'UP'` で反発・吸着・速度依存狭窄を行う分岐はありません。UPを識別する物理差は `kazaaan-data.js` の `width=.84` のみです。物理ファイルに残る `UP` 文字列は描画色の分類です。

公開攻略記録は「UPは他より少し幅が狭い」「すんなり入らない場合がある」ことを支持しますが、`.84` という比率は公開公式値ではありません。そのためv0.9では新たな力学補正を足さず、現値を再現パラメータとして維持します。

### UP後の“ふわっと出る”見え方
v0.8ではUP確定後のtransfer開始点が固定入口位置だったため、捕捉中の球の実位置と遷移アニメーションの初期位置が一致しませんでした。v0.9では 0.90秒の入賞追随後、`capturedBallAngle()` で**その時点の公転後位置**を取得し、そこからポケット内部へ沈下してスロープへ接続します。捕捉瞬間の古い `trial.theta` へ戻る処理はありません。これは抽選物理ではなく表示遷移の不整合修正です。

### HAPTIC PAYOUT
`PAYOUT_HAPTICS_AUDIT_v0_9.md`へ全ルールを分離しました。v0.8でドリフトしていた初期確定式を復元し、DCB/HAPTICS PARTY系のリアルタイム表示思想のみ追加しました。
