# 541 VOLCAAANO!!! v0.13 — BALL / SOLID-SURFACE AUDIT

## Problem addressed
v0.12 used finite ball radius for cavity side walls, but the solid carrier top still placed the BALL CENTRE only about +0.006 radial-scale above the drawn carrier outer contour. Visually, a 5–10 px ball could therefore appear embedded in the dark solid material.

## v0.13 correction
- cavity angular width is NOT reduced further.
- UP remains `width=.84`; ordinary cells remain `width=1.00`.
- no UP-specific bounce, suction, lateral kick, or speed-dependent narrowing was added.
- only SOLID carrier support uses a radial visible-ball-radius offset.
- collision uses the predicted next radial position to prevent a one-frame 120 Hz tunnel into the solid top.

## Important compensation
Simply moving the solid support outward initially made narrow UP cells harder to enter because the old cavity-engage depth stayed fixed.

v0.13 therefore shifts the cavity-engage centre threshold outward by the exact same support offset. This preserves the physical drop distance from solid support to cavity engagement instead of silently changing game odds.

### 1ST-stage comparison — identical deterministic 1,400-ball sample
- v0.12: UP 418 / OUT 982 / unresolved 0 / UP share 29.857%
- v0.13: UP 419 / OUT 981 / unresolved 0 / UP share 29.929%

Difference: +0.071 percentage points in this deterministic sample. The solid-surface visual fix did not materially change entry odds.

## v0.13 direct physics sample
700 balls per stage:
- S1: OUT 489 / UP 211 / unresolved 0 / max same-contact streak 2
- S2: OUT 259 / WIN 206 / Q 150 / UP 85 / unresolved 0 / max same-contact streak 1
- S3: JPC 114 / HOLD 468 / Q 118 / unresolved 0 / max same-contact streak 1

No time-based forced capture, centre suction, or UP-only force was introduced.
