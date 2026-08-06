const adapt = require("./_adapt");
module.exports = adapt(require("../netlify/functions/create-payment-intent").handler);
