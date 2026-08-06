/**
 * Runs a Netlify-style handler on Vercel.
 *
 * Netlify hands the function an `event` object and expects
 * `{ statusCode, headers, body }` back. Vercel hands it `(req, res)`.
 * This wraps one in the other so every file in netlify/functions/ keeps
 * working untouched — and still runs on Netlify if you ever move back.
 */

// Read the request body as raw bytes. Stripe signature verification needs the
// exact bytes it was sent, so never re-serialize a parsed object for that path
// (routes that need it export `config.api.bodyParser = false`, which leaves the
// stream unread for us). The fallbacks cover routes where Vercel already parsed.
async function rawBody(req) {
  if (req.readable && !req.readableEnded) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  const b = req.body;
  if (b == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(b)) return b;
  if (typeof b === "string") return Buffer.from(b, "utf8");
  return Buffer.from(JSON.stringify(b), "utf8");
}

function toEvent(req, raw) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // req.query carries dynamic route segments (e.g. [id]); the search params
  // carry anything the caller appended. Both land in queryStringParameters,
  // which is where the handlers look.
  const query = { ...Object.fromEntries(url.searchParams), ...(req.query || {}) };

  return {
    httpMethod: req.method,
    path: url.pathname,
    headers: req.headers,
    queryStringParameters: query,
    body: raw.length ? raw.toString("utf8") : null,
    isBase64Encoded: false,
  };
}

module.exports = function adapt(handler) {
  return async function (req, res) {
    try {
      const raw = await rawBody(req);
      const result = (await handler(toEvent(req, raw), {})) || {};
      const { statusCode = 200, headers = {}, body = "" } = result;

      for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      res.status(statusCode).send(body);
    } catch (err) {
      // Without this an unhandled throw surfaces only as FUNCTION_INVOCATION_FAILED
      // with no detail in the browser.
      console.error(`[${req.method} ${req.url}]`, err);
      res.status(500).json({ error: "Function failed", detail: String((err && err.message) || err) });
    }
  };
};
