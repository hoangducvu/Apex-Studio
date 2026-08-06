const adapt = require("./_adapt");

module.exports = adapt(require("../netlify/functions/webhook").handler);

// Stripe verifies the signature against the exact bytes it sent, so the body
// must reach the handler unparsed. Without this Vercel would JSON-parse it and
// every webhook would fail signature verification.
module.exports.config = { api: { bodyParser: false } };
