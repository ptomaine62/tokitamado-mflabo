# HAPTIC KAZAAAN v0.10 — SJP PAYOUT DESIGN AUDIT

## Purpose
v0.9.1までのSJPは「通常払い出しを長時間・後半強化」で表現していたため、高倍率の通常払い出しと瞬間的な強さが近づくケースがありました。
v0.10では通常払い出しを一切変更せず、SJPだけを専用の刺激エンベロープへ分離します。

## Absolute rules preserved
- HAPTIC PAYOUT total = BET × actual result multiplier.
- SJP ×100 therefore pays exactly BET × 100 HAPTIC units.
- No additional/phantom stimulation count is added at block boundaries or finale.
- A/B LIMIT is proportional scaling: final effective % = command % × LIMIT % / 100.
- Hardware BF soft limit is also written from the configured LIMIT and remains an absolute ceiling.
- Game physics and payout result are independent from haptics.

## SJP amount blocks
The real SJP payout is grouped by total amount:

| SJP total | Block target |
|---:|---:|
| <= 1000 | 100 |
| 1001–3000 | 250 |
| 3001–6000 | 400 |
| > 6000 | 600 |

Examples:
- BET5 / 500 => 100 × 5 blocks
- BET10 / 1000 => 100 × 10 blocks
- BET30 / 3000 => 250 × 12 blocks
- BET50 / 5000 => 400 × 13 blocks (last partial)
- BET99 / 9900 => 600 × 17 blocks (last partial)

A block boundary inserts a real zero-output break, but no extra payout or stimulus is created.
The break becomes shorter as total SJP progress rises.

## SJP-specific intensity envelope
Normal payout retains the v0.9.1 mapping.
SJP uses the same chunk-derived mapping as a base, then applies an SJP-only minimum envelope:

- Command Power floor: 78% -> 100% across overall progress.
- HARDNESS floor: 0.72 -> 1.00 across overall progress.
- Within each block, Power/HARDNESS rises slightly toward the end of the block.
- First pulse of a new block receives a small onset accent, still clamped to Command 100%.
- Final block is FINALE: Power floor 95% -> 100%, HARDNESS floor 0.96 -> 1.00.

The configured A/B LIMIT remains the final scale/ceiling. Example with LIMIT 30%:
- Command 80% => effective 24%.
- Command 95% => effective 28.5%.
- Command 100% => effective 30%.

## Density envelope
Normal payout is unchanged: approx 0.405 s ON + 0.095 s zero gap.
SJP:
- Ordinary SJP block: ON about 0.32 -> 0.25 s as progress rises.
- Intra-block zero gap: about 0.032 -> 0.008 s.
- Block break: about 0.40 -> 0.12 s.
- FINALE: 0.30 s ON + 0.004 s zero gap.

This makes SJP denser and more pressurized than normal payout while retaining recognizable amount-based block boundaries.

## Representative simulation
Deterministic formula replay (not a tactile measurement):

| BET | SJP | Block | Blocks | Stimulus chunks | Approx duration |
|---:|---:|---:|---:|---:|---:|
| 5 | 500 | 100 | 5 | 22 | 8.0 s |
| 10 | 1000 | 100 | 10 | 44 | 16.0 s |
| 30 | 3000 | 250 | 12 | 124 | 41.7 s |
| 50 | 5000 | 400 | 13 | 159 | 52.1 s |
| 99 | 9900 | 600 | 17 | 164 | 54.6 s |

BET99 was about 61.3 s in the previous example. v0.10 packs slightly more amount-boundary chunks into about 54.6 s, with much shorter intra-block gaps and a dedicated finale.

## UI
During SJP the payout panel now displays:
- current SJP block / block count
- amount delivered inside the current block
- FINALE badge on the final block
- current preset / class
- Command Power
- effective A/B Power after LIMIT scaling
- current A/B Hz and WIDTH
