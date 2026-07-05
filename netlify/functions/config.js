const { json, options } = require("./_helpers");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  return json(200, { publishableKey: process.env.STRIPE_PUBLISHABLE_KEY });
};
