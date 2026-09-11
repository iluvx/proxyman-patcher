#!/usr/bin/env bun
/**
 * Proxyman 3.19.0 (Windows/Linux Electron) PRO patcher.
 *
 * The desktop app is Electron. Premium is a local flag in dist/main/main.js:
 *   isAuthorized === (_license !== undefined)
 * plus an online device check that can wipe a fake license.data.
 *
 * This rewrites those gates in app.asar. No IDA, no keygen, no license server.
 *
 * Usage:
 *   bun patch.mjs              patch installed Proxyman
 *   bun patch.mjs --restore    restore app.asar.bak
 *   bun patch.mjs --asar PATH  patch a specific app.asar
 *
 * Target: Proxyman 3.19.0. Webpack minified identifiers (zd, Wd, ...) change
 * across builds — if a patch misses, the app was updated.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BACKUP_SUFFIX = ".bak";

const PATCHES = [
  {
    name: "isAuthorized always true",
    from: "get isAuthorized(){return void 0!==this._license}",
    to: "get isAuthorized(){return !0}",
  },
  {
    name: "isLicenseExpired always false",
    from: 'isLicenseExpired(){if(console.log("Checking license expiration..."),void 0===this.activeLicense)return;const e=Date.now();return Date.parse(this.activeLicense.updatesAvailableUntil)<e}',
    to: "isLicenseExpired(){return !1}",
  },
  {
    name: "verifyLicense no-op (skip online revoke)",
    from: 'verifyLicense(){return zd(this,null,(function*(){if(console.log("Verify License..."),void 0===this.activeLicense)return void console.log("No License Found!");',
    to: 'verifyLicense(){return zd(this,null,(function*(){return;if(console.log("Verify License..."),void 0===this.activeLicense)return void console.log("No License Found!");',
  },
  {
    name: "validateLicenseStatus inject in-memory license",
    from: "validateLicenseStatus(){return zd(this,null,(function*(){try{const e=this.getLicensePath();",
    to: 'validateLicenseStatus(){return zd(this,null,(function*(){this.license={sign:"1",deviceID:this.currentUniqueDeviceID||"x",email:"pro@local",updatesAvailableUntil:"2099-12-31T23:59:59.000Z",purchaseAt:"2020-01-01T00:00:00.000Z"};return;try{const e=this.getLicensePath();',
  },
  {
    name: "device id match always true",
    from: "isLicenseKeyMatchThisMachine(e){return this.isDeviceIDMatchThisMachine(e.deviceID)}",
    to: "isLicenseKeyMatchThisMachine(e){return !0}",
  },
  {
    name: "premium tool limits always false",
    from: "checkIfExceedThePreimumLimit(e,t){if(Wd.isAuthorized)return!1;",
    to: "checkIfExceedThePreimumLimit(e,t){return !1;if(Wd.isAuthorized)return!1;",
  },
];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function defaultAsarPath() {
  if (process.env.PROXYMAN_ASAR) return process.env.PROXYMAN_ASAR;
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || "",
      "Programs",
      "proxyman",
      "resources",
      "app.asar"
    );
  }
  if (process.platform === "linux") {
    const home = os.homedir();
    const candidates = [
      path.join(home, ".local", "share", "proxyman", "resources", "app.asar"),
      "/opt/Proxyman/resources/app.asar",
      "/usr/lib/proxyman/resources/app.asar",
    ];
    return candidates.find((p) => fs.existsSync(p)) || candidates[0];
  }
  fail("macOS Proxyman is native, not this Electron asar. Windows/Linux only.");
}

function parseArgs(argv) {
  const args = { restore: false, asar: null, skipKill: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--restore") args.restore = true;
    else if (a === "--skip-kill") args.skipKill = true;
    else if (a === "--asar") args.asar = argv[++i];
    else if (a === "-h" || a === "--help") {
      console.log(`Usage:
  bun patch.mjs [--asar PATH] [--skip-kill]
  bun patch.mjs --restore [--asar PATH]

Env:
  PROXYMAN_ASAR   override path to app.asar`);
      process.exit(0);
    } else fail(`unknown arg: ${a}`);
  }
  return args;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...opts,
  });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} failed (${r.status})`);
}

function killProxyman() {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/IM", "Proxyman.exe"], { stdio: "ignore" });
    spawnSync("taskkill", ["/F", "/IM", "proxyman-cli.exe"], { stdio: "ignore" });
    return;
  }
  spawnSync("pkill", ["-f", "Proxyman"], { stdio: "ignore" });
}

function alreadyPatched(js) {
  return (
    js.includes("get isAuthorized(){return !0}") &&
    js.includes('email:"pro@local"')
  );
}

function applyPatches(js) {
  if (alreadyPatched(js)) return { js, skipped: true, applied: [] };
  const applied = [];
  let out = js;
  for (const p of PATCHES) {
    const n = out.split(p.from).length - 1;
    if (n !== 1) {
      fail(
        `patch "${p.name}" matched ${n} times (need 1). Wrong Proxyman version or already mutated.`
      );
    }
    out = out.replace(p.from, p.to);
    applied.push(p.name);
  }
  return { js: out, skipped: false, applied };
}

function asarCli(args) {
  run("bunx", ["--yes", "@electron/asar", ...args]);
}

function restore(asarPath) {
  const bak = asarPath + BACKUP_SUFFIX;
  if (!fs.existsSync(bak)) fail(`no backup at ${bak}`);
  killProxyman();
  fs.copyFileSync(bak, asarPath);
  console.log(`restored ${asarPath} from ${bak}`);
}

function patch(asarPath, skipKill) {
  if (!fs.existsSync(asarPath)) fail(`asar not found: ${asarPath}`);

  const bak = asarPath + BACKUP_SUFFIX;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "proxyman-patch-"));
  const extracted = path.join(work, "extracted");
  const packed = path.join(work, "app.asar");
  const mainJs = path.join(extracted, "dist", "main", "main.js");

  try {
    if (!skipKill) {
      console.log("stopping Proxyman if running");
      killProxyman();
    }

    if (!fs.existsSync(bak)) {
      fs.copyFileSync(asarPath, bak);
      console.log(`backup ${bak} (${fs.statSync(bak).size} bytes)`);
    } else {
      console.log(`backup already exists ${bak}`);
    }

    console.log("extracting asar");
    fs.mkdirSync(extracted);
    asarCli(["extract", asarPath, extracted]);

    if (!fs.existsSync(mainJs)) fail(`missing ${mainJs}`);
    const original = fs.readFileSync(mainJs, "utf8");
    const { js, skipped, applied } = applyPatches(original);
    if (skipped) {
      console.log("already patched, nothing to do");
      return;
    }
    fs.writeFileSync(mainJs, js);
    for (const name of applied) console.log(`  ok  ${name}`);
    console.log(`main.js ${original.length} -> ${js.length}`);

    console.log("packing asar");
    asarCli(["pack", extracted, packed]);
    fs.copyFileSync(packed, asarPath);
    console.log(`wrote ${asarPath} (${fs.statSync(asarPath).size} bytes)`);
    console.log("done. start Proxyman — UI should show registered to pro@local");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
const asarPath = path.resolve(args.asar || defaultAsarPath());
console.log(`asar: ${asarPath}`);
if (args.restore) restore(asarPath);
else patch(asarPath, args.skipKill);
