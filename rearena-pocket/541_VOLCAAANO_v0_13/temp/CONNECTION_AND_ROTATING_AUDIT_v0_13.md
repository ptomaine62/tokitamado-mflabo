# 541 VOLCAAANO!!! v0.13 — CONNECTION / ROTIATING DEVICE AUDIT

## E-STIM DEVICE

- Browser-direct Web Bluetooth remains the runtime architecture.
- AUTO mode:
  - tries already-authorized devices via `navigator.bluetooth.getDevices()` when available;
  - otherwise opens a chooser filtered to the known E-STIM device name prefix.
- MANUAL mode:
  - opens a broad `acceptAllDevices` chooser;
  - the selected device must expose the required service/characteristics or connection fails visibly.
- Explicit DISCONNECT is present.
- Reconnect initialization writes BF before `ready=true`.
- A/B HOLD TEST:
  - independent A or B;
  - hold-only;
  - ~3.5 s linear command ramp 0 -> 100% of the configured channel LIMIT;
  - other channel is zero during test;
  - release / pointer-cancel / blur / hidden page sends zero.

Reference behavior checked against prior DICE CHARGE BATTLE / SMART HAPTICS builds:
- independent A/B HOLD TEST;
- manual scan/select/connect/disconnect concept;
- connection-mode separation;
- reconnect initialization / zero routes.

## ROTIATING DEVICE (hidden mode)

Reference transport checked against the prior common BLE core:
- service: `0000ffa0-0000-1000-8000-00805f9b34fb`
- write: `0000ffa1-0000-1000-8000-00805f9b34fb`
- output frame: `A0 03 POWER 00 00 00 AA`
- logical 0..100% -> POWER byte 0..255
- update cadence: ~20 Hz / 50 ms
- AUTO hints: J-MIGHTY / JOYHUB / KiGToyBox + service UUID
- MANUAL: broad Web Bluetooth chooser, then service validation

### Hidden access
- click/tap the title `541 VOLCAAANO!!!` five times within ~3.2 s.
- `?rotating=1` also unlocks the panel for development/GitHub testing.
- unlocked state persists until factory reset.
- mode itself defaults OFF.

### Mapping

While an actual payout pulse is active (E-STIM TEST is excluded):

`SOURCE = clamp(COMMAND POWER + PRESET WAVE LEVEL, 0, 100)`

`TARGET = MIN + (MAX - MIN) * SOURCE / 100` for SOURCE > 0, otherwise 0.

This deliberately reaches MAX easily, per project requirement.

### <=25% intermittent drive

- if TARGET > 25%: continuous TARGET output.
- if 0 < TARGET <= 25%: 8 Hz PWM.
- PWM ON level is at least 25% when MAX allows it.
- duty ratio is chosen so the average requested level remains close to TARGET.
- TARGET and ACTUAL are both displayed and graphed.

## Safety / zero paths

- E-STIM emergency also immediately zeroes ROTIATING DEVICE.
- visibility hidden / pagehide zeroes both.
- ROTIATING MODE OFF zeroes the motor output.
- factory reset zeroes/disconnects before local state reset.
