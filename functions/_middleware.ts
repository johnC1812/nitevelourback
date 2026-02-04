export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);
  if (url.hostname === "nitevelour.com") {
    url.hostname = "www.nitevelour.com";
    return Response.redirect(url.toString(), 301);
  }
  return next();
};
