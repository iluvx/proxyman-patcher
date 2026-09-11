# proxyman-patcher

Patches **Proxyman 3.19.0** (Windows / Linux Electron build) so the app treats itself as licensed.

macOS Proxyman is a different native binary. This repo does not cover it.

## How the gate works

`resources/app.asar` → `dist/main/main.js` (webpack bundle).

- Premium UI and tool limits all key off `LicenseService.isAuthorized`, which is `this._license !== undefined`.
- License file is plaintext JSON at `<userData>/license.data` (`sign`, `deviceID`, `email`, `updatesAvailableUntil`, `purchaseAt`). There is **no local signature check**.
- On launch the app calls `https://proxyman.com/v1/licenses/devices-with-license`. A fake file gets deleted if that call succeeds. The patch no-ops `verifyLicense` and injects an in-memory license instead of writing `license.data`.

`checkIfExceedThePreimumLimit` returns immediately when authorized, so Map Local / Breakpoint / etc. limits drop out with the same flag.

## Usage

Needs [bun](https://bun.sh).

```bash
bun patch.mjs
```

- Stops Proxyman if it is running
- Copies `app.asar` → `app.asar.bak` (first run only)
- Extracts, patches `dist/main/main.js`, repacks, replaces `app.asar`

Restore:

```bash
bun patch.mjs --restore
```

Override install path:

```bash
bun patch.mjs --asar "D:\apps\proxyman\resources\app.asar"
```

Default Windows path:

`%LOCALAPPDATA%\Programs\proxyman\resources\app.asar`

## After a Proxyman update

The updater overwrites `app.asar`. Re-run `bun patch.mjs`. If a string misses, webpack identifiers changed — the patch list in `patch.mjs` has to be retargeted against the new `main.js`.

## Patches applied

| Gate | Effect |
|---|---|
| `isAuthorized` | always `true` |
| `isLicenseExpired` | always `false` |
| `verifyLicense` | returns without talking to proxyman.com |
| `validateLicenseStatus` | sets `_license` to `{ email: "pro@local", updatesAvailableUntil: 2099, ... }` |
| `isLicenseKeyMatchThisMachine` | always `true` |
| `checkIfExceedThePreimumLimit` | always `false` |
