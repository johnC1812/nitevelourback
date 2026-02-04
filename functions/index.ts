export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);

  // If someone lands on / with filter params (brands/gender/etc), keep the home clean and serve the live directory instead.
  if (url.pathname === "/") {
    const keys = ["brands", "gender", "page", "size", "sorting", "search", "live"];
    const hasFilters = keys.some(k => url.searchParams.has(k));
    if (hasFilters) {
      const to = new URL(url.toString());
      to.pathname = "/live/";
      return Response.redirect(to.toString(), 302);
    }
  }

  return context.next();
};
