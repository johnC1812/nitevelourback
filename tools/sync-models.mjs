#!/usr/bin/env node
/**
 * Deprecated wrapper — use tools/sync_models.mjs instead.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(__dirname, "sync_models.mjs");
const res = spawnSync(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(res.status ?? 1);
