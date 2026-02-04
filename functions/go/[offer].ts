export const onRequestGet: PagesFunction = async ({ request, params, env }) => {
  const offer = String(params.offer || "").toLowerCase();
  const url = new URL(request.url);

  // Prefer Pages env vars (Project -> Settings -> Environment variables)
  // These are not secrets, but keeping them out of git makes changing them easier.
  const CAMS_URL = (env as any)?.CAMS_URL as string | undefined;
  const DATING_URL = (env as any)?.DATING_URL as string | undefined;

  // Fallback defaults (update if you rotate links)
  const DEST: Record<string, string> = {
    cams: CAMS_URL || "https://t.acrsmartcam.com/401902/3664/0?bo=2779,2778,2777,2776,2775&target=domainredirects&po=6533&aff_sub5=SF_006OG000004lmDN",
    dating: DATING_URL || "https://t.ajrkm.link/401902/3785/0?bo=2753,2754,2755,2756&target=domainredirects&po=6456&aff_sub5=SF_006OG000004lmDN",
  };

  const dest = DEST[offer] || DEST.cams;

  // Tracking: keep it lightweight and affiliate-friendly.
  // You can pass:
  //   ?b=stripchat&p=home&pos=live_card&m=stripchat_123
  // We’ll map into aff_sub fields (without overwriting if already present).
  // Recommended convention:
  //   aff_sub1 = brand
  //   aff_sub2 = pos (entry point)
  //   aff_sub3 = page (home/live/profile/guide/platform/category)
  //   aff_sub4 = entity (model id / guide slug)
  const pos = url.searchParams.get("pos") || "";
  const brand = url.searchParams.get("b") || url.searchParams.get("brand") || "";
  const page = url.searchParams.get("p") || url.searchParams.get("page") || url.searchParams.get("cat") || "";
  const m = url.searchParams.get("m") || url.searchParams.get("id") || "";

  const out = new URL(dest);

  // Preserve caller-provided affiliate sub params (if you link with aff_sub2 already).
  for (const k of ["aff_sub1","aff_sub2","aff_sub3","aff_sub4","aff_sub5"]) {
    const v = url.searchParams.get(k);
    if (v) out.searchParams.set(k, v);
  }

  if (brand && !out.searchParams.get("aff_sub1")) out.searchParams.set("aff_sub1", brand);
  if (pos && !out.searchParams.get("aff_sub2")) out.searchParams.set("aff_sub2", pos);
  if (page && !out.searchParams.get("aff_sub3")) out.searchParams.set("aff_sub3", page);
  if (m && !out.searchParams.get("aff_sub4")) out.searchParams.set("aff_sub4", m);

  return Response.redirect(out.toString(), 302);
};
