# BALL / POCKET CODE AUDIT — v0.8

詳細は `RESEARCH_AUDIT.md` の「v0.8: BALL / POCKET full reverse-audit」を参照してください。

## 結論

v0.7には実際に残骸・不整合がありました。v0.8で次を撤去/統一済みです。

- gate中央代理判定 → 球直下判定へ
- visualGap / slitW / slitH → gateGeometry一本化
- releaseFromCarrierContact位置テレポート → 削除
- settle / timeBias / 10秒・15秒以降の強制解決補正 → 削除
- captureLocalの82%クランプ → 削除
- JPC/SJPC別描画判定 → cavityGeometry共通化
- 点質量球 → 描画球半径由来の有限半径判定
- app.jsの廃止済みcarrierGeometryAtGate呼び出し → 削除

## Automated result

`node verify_kazaaan.js` → **64/64 PASS**

## Remaining approximations

2D楕円近似、実機CAD未取得、歯先R/ポケット断面/球スピン等は未確定です。内部の描画と判定は同一幾何モデルへ統一しましたが、実機3D形状そのものの完全一致を主張するものではありません。
