#!/usr/bin/env node
/**
 * Sync performers + stable catalog for NiteVelour.
 *
 * Writes:
 *   data/performers.json  (objects used by tools/build.mjs to generate /m/<brand>/<id>/ pages)
 *   data/catalog.json     (stable list of performer itemIds used for:
 *                          - static profile generation
 *                          - filtering /api/live so "Profile" always resolves)
 *
 * Default behavior:
 *   - If data/catalog.json exists, keep its ids order stable (no churn), and refresh performer objects where possible.
 *   - If data/catalog.json is missing, create a balanced catalog across enabled brands.
 *
 * Usage (PowerShell):
 *   $env:CRAK_API_KEY="..."
 *   $env:CRAK_TOKEN="..."
 *   $env:CRAK_UA="nitevelour.com"
 *   node tools/sync_models.mjs --max 10000
 *
 * Optional:
 *   node tools/sync_models.mjs --max 10000 --brands stripchat,chaturbate,awempire,streamate
 *   node tools/sync_models.mjs --reseed   (forces a new catalog)
 *
 * You can also create a local .env in the project root:
 *   CRAK_API_KEY=...
 *   CRAK_TOKEN=...
 *   CRAK_UA=nitevelour.com
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_BASE = "https://performersext-api.pcvdaa.com/performers-ext";

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  const raw = fs.readFileSync(p, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const k = m[1];
    let v = m[2] ?? "";
    // Strip surrounding quotes
    v = v.replace(/^\s*["']/, "").replace(/["']\s*$/, "");
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

function arg(name, defVal = null) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return defVal;
}
function hasFlag(name) {
  return process.argv.includes(name);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readJSONIfExists(absPath) {
  try {
    if (!fs.existsSync(absPath)) return null;
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeBrand(s) {
  const b = String(s || "").toLowerCase().trim();
  if (!b) return "";
  // keep keys consistent with your URLs & build.mjs brandLabel()
  if (b.includes("bonga")) return "bongacams";
  if (b.includes("royal")) return "royalcams";
  return b;
}

function brandKeyFrom(p, fallback = "") {
  return normalizeBrand(p?.systemSource || p?.source || p?.brand || fallback);
}

function idFor(p) {
  const id = String(p?.itemId || p?.id || "").trim();
  return id;
}

function arraysEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (String(a[i]) !== String(b[i])) return false;
  return true;
}

async function fetchPage({ apiKey, token, ua, brand, page, size }) {
  const url = new URL(API_BASE);
  url.searchParams.set("token", token);
  url.searchParams.set("brands", brand);
  url.searchParams.set("page", String(page));
  url.searchParams.set("size", String(size));
  url.searchParams.set("sorting", "score");

  const res = await fetch(url, {
    headers: {
      "x-api-key": apiKey,
      "User-Agent": ua,
      "accept": "application/json"
    }
  });

  const txt = await res.text().catch(() => "");
  if (!res.ok) {
    // If a brand isn't enabled on your token, Crak returns unauthorized; skip it.
    console.warn(`WARN: ${brand} page ${page} -> ${res.status} ${txt.slice(0, 140)}`);
    return [];
  }
  try {
    const data = JSON.parse(txt);
    const arr = Array.isArray(data?.performers) ? data.performers : (Array.isArray(data?.data) ? data.data : []);
    return Array.isArray(arr) ? arr : [];
  } catch {
    console.warn(`WARN: failed to parse JSON for ${brand} page ${page}: ${txt.slice(0, 140)}`);
    return [];
  }
}

function splitBrands(s) {
  return String(s || "")
    .split(",")
    .map((x) => normalizeBrand(x))
    .filter(Boolean);
}

function getDefaultBrandsFromConfig() {
  const cfgPath = path.join(ROOT, "site.config.json");
  const cfg = readJSONIfExists(cfgPath);
  const fromCfg = Array.isArray(cfg?.crak?.brands) ? cfg.crak.brands : [];
  const brands = fromCfg.map(normalizeBrand).filter(Boolean);
  return brands.length ? brands : ["stripchat", "chaturbate", "awempire", "streamate"];
}

async function main() {
  loadDotEnv();

  const apiKey = process.env.CRAK_API_KEY || process.env.CRAK_KEY || "";
  const token = process.env.CRAK_TOKEN || "";
  const ua = process.env.CRAK_UA || "nitevelour.com";

  if (!apiKey || !token) {
    console.error("Missing env vars: CRAK_API_KEY and/or CRAK_TOKEN.");
    process.exit(1);
  }

  let max = Number(arg("--max", "10000")) || 10000;
  if (max < 1) max = 10000;

  let size = Number(arg("--size", "100")) || 100;
  if (size < 1) size = 100;
  if (size > 100) size = 100; // API max (safe)

  const reseed = hasFlag("--reseed");

  const catalogRel = (arg("--catalog", "data/catalog.json") || "data/catalog.json").trim();
  const catalogPath = path.join(ROOT, catalogRel);
  const performersPath = path.join(ROOT, "data", "performers.json");

  // Brands: CLI > config > default
  const desiredBrands = splitBrands(arg("--brands", "")) ;
  const brandList = desiredBrands.length ? desiredBrands : getDefaultBrandsFromConfig();
  const nBrands = brandList.length;

  // Load previous datasets (for stability)
  const prevPerf = readJSONIfExists(performersPath);
  const prevArr = prevPerf && Array.isArray(prevPerf.performers) ? prevPerf.performers : [];
  const prevMap = new Map();
  for (const p of prevArr) {
    const id = idFor(p);
    if (id && !prevMap.has(id)) prevMap.set(id, p);
  }

  const prevCat = readJSONIfExists(catalogPath);
  let prevIds = [];
  let prevBrands = [];
  if (prevCat) {
    if (Array.isArray(prevCat)) prevIds = prevCat;
    else if (Array.isArray(prevCat.ids)) prevIds = prevCat.ids;
    if (Array.isArray(prevCat?.brands)) prevBrands = prevCat.brands.map(normalizeBrand).filter(Boolean);
  }
  prevIds = prevIds.map((x) => String(x)).filter(Boolean);

  const brandsChanged = prevBrands.length && (prevBrands.join(",") !== brandList.join(","));
  const needReseed = reseed || !prevIds.length || brandsChanged;

  if (brandsChanged && !reseed) {
    console.warn("[sync] Brand list changed vs catalog.json — reseeding catalog automatically.");
  }

  // Quotas for balanced fresh fetch
  const base = Math.floor(max / nBrands);
  const extra = max % nBrands;
  const quota = new Map();
  for (let i = 0; i < nBrands; i++) quota.set(brandList[i], base + (i < extra ? 1 : 0));

  const seen = new Set();
  const freshByBrand = new Map();
  for (const b of brandList) freshByBrand.set(b, []);

  for (const brand of brandList) {
    const want = quota.get(brand) || 0;
    if (want <= 0) continue;

    let page = 1;
    while ((freshByBrand.get(brand) || []).length < want) {
      const arr = await fetchPage({ apiKey, token, ua, brand, page, size });
      if (!arr.length) break;

      for (const p of arr) {
        const id = idFor(p);
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        (freshByBrand.get(brand) || []).push(p);
        if ((freshByBrand.get(brand) || []).length >= want) break;
      }
      page += 1;
      await sleep(250);
      if (page > 250) break; // safety
    }
  }

  const fresh = [];
  for (const b of brandList) fresh.push(...(freshByBrand.get(b) || []));

  // Merge previous + fresh (fresh wins)
  const merged = new Map(prevMap);
  for (const p of fresh) {
    const id = idFor(p);
    if (!id) continue;
    merged.set(id, p);
  }

  // Build stable catalog ids
  const outIds = [];
  const used = new Set();

  if (!needReseed) {
    for (const id of prevIds) {
      if (!merged.has(id)) continue;
      if (used.has(id)) continue;
      used.add(id);
      outIds.push(id);
      if (outIds.length >= max) break;
    }
  }

  // Fill / reseed using balanced fresh order
  for (const p of fresh) {
    if (outIds.length >= max) break;
    const id = idFor(p);
    if (!id || used.has(id)) continue;
    used.add(id);
    outIds.push(id);
  }

  // Final fill if short
  if (outIds.length < max) {
    for (const id of merged.keys()) {
      if (outIds.length >= max) break;
      if (used.has(id)) continue;
      used.add(id);
      outIds.push(id);
    }
  }

  const outPerformers = outIds.map((id) => merged.get(id)).filter(Boolean);

  // Counts by brand (for sanity)
  const counts = {};
  for (const p of outPerformers) {
    const b = brandKeyFrom(p, "");
    counts[b || "unknown"] = (counts[b || "unknown"] || 0) + 1;
  }

  // Write performers.json (always)
  fs.mkdirSync(path.dirname(performersPath), { recursive: true });
  fs.writeFileSync(
    performersPath,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), brands: brandList, count: outPerformers.length, performers: outPerformers },
      null,
      2
    )
  );

  // Write catalog.json only if it changes (prevents churn)
  const nextCat = { generatedAt: new Date().toISOString(), brands: brandList, max, count: outIds.length, ids: outIds };
  const prevIdsComparable = prevIds.slice(0, max);
  const idsChanged = !arraysEqual(prevIdsComparable, outIds);

  if (needReseed || idsChanged || !prevCat) {
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
    fs.writeFileSync(catalogPath, JSON.stringify(nextCat, null, 2));
  }

  console.log(`Wrote ${outPerformers.length} performers to ${performersPath}`);
  console.log(`Catalog ids: ${outIds.length} (${needReseed ? "reseed" : (idsChanged ? "updated" : "unchanged")}) -> ${catalogPath}`);
  console.log("[sync] counts by brand:", counts);
  console.log("Next: npm run build && npm run deploy");
}

main().catch((e) => {
  console.error(e?.stack || e?.message || String(e));
  process.exit(1);
});
