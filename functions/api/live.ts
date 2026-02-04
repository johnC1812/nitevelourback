import { CATALOG_SET } from "../_generated/catalog";

type Env = {
  CRAK_PERFORMERS_URL?: string;
  CRAK_TOKEN?: string;
  CRAK_API_KEY?: string;
  CRAK_KEY?: string;
  CRAK_UA?: string;
};

const DEFAULT_BASE = "https://performersext-api.pcvdaa.com/performers-ext";
const UPSTREAM_PAGE_SIZE = 100;
const MAX_SCAN_PAGES = 12;
const DEFAULT_BRANDS = ["stripchat","chaturbate","awempire","streamate"] as const;

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) {
    // Keep this short; live status changes constantly.
    headers.set("cache-control", "no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function clampInt(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

function parseBool(v: string | null | undefined, def = false) {
  if (v == null) return def;
  const s = v.toLowerCase().trim();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return def;
}

function parseBrands(brandsParam: string) {
  return new Set(
    brandsParam
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function normalizeGender(raw: unknown): "m" | "f" | "c" | "t" | "" {
  const v = (typeof raw === "string" ? raw : "").toLowerCase().trim();
  if (["m", "male", "man", "guy"].includes(v)) return "m";
  if (["f", "female", "woman", "girl"].includes(v)) return "f";
  if (["c", "couple", "pair"].includes(v)) return "c";
  if (["t", "trans", "transgender"].includes(v)) return "t";
  return "";
}

function detectLive(p: any): boolean {
  if (!p) return false;
  const liveFlag = p.live === true || String(p.live).toLowerCase() === "true";
  // Some upstream systems may omit `live` but keep URLs for live players.
  const hasPlayable = Boolean(p.roomUrl || p.iframeFeedURL || p.iframeFeedUrl || p.iframeUrl);
  return liveFlag && hasPlayable;
}

function topicMatch(p: any, topic: string): boolean {
  const t = topic.toLowerCase().trim();
  if (!t) return true;
  const bucket: string[] = [];
  if (Array.isArray(p.customTags)) bucket.push(...p.customTags);
  if (Array.isArray(p.characteristicsTags)) bucket.push(...p.characteristicsTags);
  if (Array.isArray(p.autoTags)) bucket.push(...p.autoTags);
  const hay = bucket
    .map((s) => String(s).toLowerCase())
    .join(" ");
  return hay.includes(t);
}

function nameMatch(p: any, q: string): boolean {
  const s = q.toLowerCase().trim();
  if (!s) return true;
  const name = String(p.nameClean || p.name || "").toLowerCase();
  return name.includes(s);
}

function parseTags(p: any): string[] {
  // Some upstream records have `tags` as an array; others may have a single string.
  const raw = p?.tags ?? p?.Tags ?? p?.topics ?? p?.Topics;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((t) => String(t ?? "").toLowerCase().trim())
      .filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(/[,\s]+/g)
      .map((t) => t.toLowerCase().trim())
      .filter(Boolean);
  }
  return [];
}


async function fetchUpstream(
  baseUrl: string,
  token: string,
  ua: string,
  apiKey: string,
  brands: string[],
  page: number,
  liveOnly: boolean
): Promise<any[]> {
  const u = new URL(baseUrl);
  u.searchParams.set("token", token);
  u.searchParams.set("page", String(page));
  u.searchParams.set("size", String(UPSTREAM_PAGE_SIZE));
  u.searchParams.set("sorting", "score");
  if (brands.length) u.searchParams.set("brands", brands.join(","));
  if (liveOnly) u.searchParams.set("live", "true");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(u.toString(), {
      headers: {
        accept: "application/json",
        "user-agent": ua,
        "x-api-key": apiKey,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    const arr = (data && Array.isArray(data.performers) ? data.performers : []) as any[];
    return arr;
  } finally {
    clearTimeout(timeout);
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  try {
    const url = new URL(ctx.request.url);
    const sp = url.searchParams;

    const page = clampInt(parseInt(sp.get("page") || "1", 10) || 1, 1, 999);
    const size = clampInt(parseInt(sp.get("size") || "24", 10) || 24, 1, 60);

    const brandsParam = (sp.get("brands") || sp.get("brand") || "").trim();
    let brandSet = brandsParam ? parseBrands(brandsParam) : new Set<string>();
    if (brandSet.size === 0) brandSet = new Set(DEFAULT_BRANDS);

    const gender = normalizeGender(sp.get("gender"));
    const search = (sp.get("search") || "").trim();

    const topic = (sp.get("topic") || "").trim();
    const strictTopic = parseBool(sp.get("strictTopic"), false);
    const topicRequested = Boolean(topic);

    // Default to live-only.
    const wantLive = parseBool(sp.get("live"), true);
    const debug = parseBool(sp.get("debug"), false);

    const baseUrl = ctx.env.CRAK_PERFORMERS_URL || DEFAULT_BASE;
    const token = ctx.env.CRAK_TOKEN;
    const apiKey = ctx.env.CRAK_API_KEY || ctx.env.CRAK_KEY;
    const ua = ctx.env.CRAK_UA || "nitevelour/1.0";

    if (!token || !apiKey) {
      return json({ ok: false, version: "livefix5", error: "missing_crak_config" }, { status: 500 });
    }

    // Scan enough upstream pages to fill the requested page after catalog filtering.
    const targetCount = page * size;
    const desiredCollected = Math.max(targetCount + size * 2, 80);

    const served: any[] = [];
    const servedTopic: any[] = [];
    const seen = new Set<string>();

    const brandsForUpstream = Array.from(brandSet);

    let pagesFetched = 0;
    let itemsSeen = 0;
    let itemsParsed = 0;

    for (let upPage = 1; upPage <= MAX_SCAN_PAGES; upPage++) {
      const items = await fetchUpstream(baseUrl, token, ua, apiKey, brandsForUpstream, upPage, wantLive);
      pagesFetched++;
      itemsSeen += items.length;

      if (items.length === 0) break;

      for (const p of items) {
        const itemId = String(p?.itemId || "").trim();
        if (!itemId) continue;
        if (!CATALOG_SET.has(itemId)) continue;
        if (seen.has(itemId)) continue;
        seen.add(itemId);

        // Best-effort live filtering.
        if (wantLive && !detectLive(p)) continue;

        if (gender) {
          const g = normalizeGender(p?.characteristic?.genderCode || p?.characteristic?.gender || p?.genderCode || p?.gender);
          if (gender === "t") {
            const tags = [...parseTags(p?.tags), ...parseTags(p?.customTags)];
            if (g !== "t" && !tags.includes("trans") && !tags.includes("transgender")) continue;
          } else {
            if (g && g !== gender) continue;
          }
        }

        if (!nameMatch(p, search)) continue;

        // Keep only a small number of fields? We keep the object as-is for now to
        // avoid breaking older front-end expectations.
        itemsParsed++;
        served.push(p);
        if (topicRequested && topicMatch(p, topic)) servedTopic.push(p);

        if (served.length >= desiredCollected) break;
      }

      if (served.length >= desiredCollected) break;
    }

    let pool = served;
    let topicApplied = false;

    if (topicRequested) {
      if (strictTopic) {
        pool = servedTopic;
        topicApplied = true;
      } else if (servedTopic.length >= Math.max(4, Math.min(size, 12))) {
        pool = servedTopic;
        topicApplied = true;
      }
    }

    const start = (page - 1) * size;
    const pageItems = pool.slice(start, start + size);

    const payload: any = {
    ok: true,
    version: "livefix5",
      count: pageItems.length,
      total: pool.length,
      page,
      size,
      topic,
      topicRequested,
      topicApplied,
      performers: pageItems,
      // Legacy aliases for older front-ends.
      models: pageItems,
      items: pageItems,
    };

    if (debug) {
      payload.debug = {
        requested: {
          brands: brandsParam || "(all)",
          gender,
          search,
          live: String(wantLive),
          topic,
          strictTopic,
        },
        upstream: {
          pagesFetched,
          pageSize: UPSTREAM_PAGE_SIZE,
          itemsSeen,
          itemsParsed,
        },
        matches: {
          baseCollected: served.length,
          topicCollected: servedTopic.length,
          servedPool: pool.length,
        },
      };
    }

    return json(payload);
  } catch (err: any) {
    return json(
      {
        ok: false,
    version: "livefix5",
    error: "internal_error",
        message: String(err?.message || err),
      },
      { status: 500 }
    );
  }
};
