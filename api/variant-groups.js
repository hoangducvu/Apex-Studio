const adapt = require("./_adapt");
module.exports = adapt(require("../netlify/functions/variant-groups").handler);
