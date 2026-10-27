// Vite's standalone Vercel Functions do not implement Next.js catch-all filenames.
// vercel.json sends every /api/* request to one flat function with its original path.
export function withVercelRouting(handler) {
  return (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = req.query?.__trn_path ?? url.searchParams.get('__trn_path');
    if (route !== null && route !== undefined) {
      if (typeof route !== 'string' || !/^[A-Za-z0-9_/-]+$/.test(route)) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        return res.end(JSON.stringify({ error: 'Invalid API route.' }));
      }
      url.searchParams.delete('__trn_path');
      req.url = `/api/${route.replace(/^\/+|\/+$/g, '')}${url.search}`;
    }
    return handler(req, res);
  };
}
