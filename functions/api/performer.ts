import { CATALOG_SET } from "../_generated/catalog";

type Env = {
  CRAK_PERFORMERS_URL?: string;
  CRAK_API_KEY?: string;
  CRAK_KEY?: string;
  CRAK_UA?: string;
};

const DEFAULT_BASE = "https://performers-api.pcvdaa.com/v2/performers";

function json(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) {
    // Keep very short caching so profile status can update quickly.
    headers.set("cache-control", "no-store, max-age=0");
  headers.set("pragma", "no-cache");
  headers.set("expires", "0");
  }
  return new Response(JSON.stringify(data), { ...init, headers });
}

function detectLive(p: any): boolean {
  if (!p) return false;
  if (p.live === true) return true;
  const status = String(p.status ?? "").toLowerCase();
  if (status === "live" || status === "online") return true;
  // Some providers omit a boolean; URLs are a reasonable proxy.
  return Boolean(p.roomUrl || p.iframeFeedURL || p.iframeFeedUrl || p.embedUrl);
}

async function fetchJson(url: string, headers: Record<string, string>, timeoutMs = 9000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`Upstream ${res.status}`);
    return (await res.json()) as any;
  } finally {
    clearTimeout(t);
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const url = new URL(ctx.request.url);
  const brand = url.searchParams.get("brand") || url.searchParams.get("system") || "";
  const name = url.searchParams.get("name") || "";

  if (!brand || !name) {
    return json(
      { ok: false, version: "livefix5", error: "Missing required query params: brand and name" },
      { status: 400 }
    );
  }

  const base = (ctx.env.CRAK_PERFORMERS_URL || DEFAULT_BASE).replace(/\/$/, "");
  const key = ctx.env.CRAK_API_KEY || ctx.env.CRAK_KEY || "";
  const ua = ctx.env.CRAK_UA || "nitevelour";

  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": ua,
  };

  // The v2 endpoint typically expects an API key.
  if (key) headers["X-Api-Key"] = key;

  const nameClean = String(name).toLowerCase().replace(/[^a-z0-9_\-]/g, "");

  // Try a couple of query variants; different systems behave slightly differently.
  const attempts = [
    `${base}?system=${encodeURIComponent(brand)}&name=${encodeURIComponent(name)}&limit=10`,
    `${base}?system=${encodeURIComponent(brand)}&name=${encodeURIComponent(nameClean)}&limit=10`,
    `${base}?system=${encodeURIComponent(brand)}&search=${encodeURIComponent(name)}&limit=10`,
  ];

  let data: any = null;
  let lastErr: any = null;
  for (const u of attempts) {
    try {
      data = await fetchJson(u, headers);
      if (data) break;
    } catch (e) {
      lastErr = e;
    }
  }

  const list = Array.isArray(data?.performers)
    ? data.performers
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data?.data)
          ? data.data
          : [];

  // Pick the closest match; fall back to first.
  const pick =
    list.find((p: any) => String(p?.nameClean ?? "").toLowerCase() === nameClean) ||
    list.find((p: any) => String(p?.name ?? "").toLowerCase() === String(name).toLowerCase()) ||
    list[0] ||
    null;

  if (!pick) {
    return json(
      {
        ok: true,
        notFound: true,
        performer: null,
        model: null,
        live: false,
        error: lastErr ? String(lastErr) : "not found",
      },
      { status: 200 }
    );
  }

  // Only return the performer if it exists in our catalog OR the caller explicitly asks for raw.
  const allowRaw = url.searchParams.get("raw") === "1";
  const itemId = String(pick.itemId ?? "");
  if (!allowRaw && itemId && !CATALOG_SET.has(itemId)) {
    // Catalog mismatch - treat as notFound for our site.
    return json({ ok: true, version: "livefix5", notFound: true, performer: null, model: null, live: false }, { status: 200 });
  }

  const live = detectLive(pick);
  return json({ ok: true, version: "livefix5", notFound: false, performer: pick, model: pick, live }, { status: 200 });
};
