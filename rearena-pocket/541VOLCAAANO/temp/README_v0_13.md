# 541 VOLCAAANO!!! v0.13

Runtime files only are kept at ZIP root:
- `index.html`
- `style.css`
- `js/kazaaan-data.js`
- `js/kazaaan-physics.js`
- `js/haptics.js`
- `js/rotating.js`
- `js/app.js`

Everything else is under `temp/` and is not required to run the app.

## v0.13 changes
- reduced visible BALL penetration into non-pocket carrier material without shrinking pocket apertures further;
- compensated cavity-engage depth so 1ST UP frequency stays effectively unchanged in deterministic comparison;
- generic `PRESET STIMULI` naming; no DG-LAB branding in runtime UI;
- factory reset;
- E-STIM AUTO/MANUAL connect + explicit disconnect;
- E-STIM A/B hold tests with ~3.5 s ramp to each channel LIMIT;
- hidden `ROTIATING DEVICE` mode;
- ROTIATING DEVICE AUTO/MANUAL BLE connection;
- ROTIATING mapping = E-STIM command power + relative preset level;
- ROTIATING MIN/MAX mapping;
- ROTIATING TARGET <=25% -> intermittent PWM;
- ROTIATING output graph appears only when MODE ON.

## Hidden ROTIATING DEVICE
Tap/click the main title five times within roughly 3.2 seconds. Development shortcut: append `?rotating=1` to the URL.

## Factory reset
Resets credit, BET, HOLD, diamond/game state, E-STIM limits/modes, hidden-device settings/unlock and connection settings. Cached preset stimulus data is intentionally retained so offline startup does not regress.
