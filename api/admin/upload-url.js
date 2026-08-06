const adapt = require("../_adapt");
module.exports = adapt(require("../../netlify/functions/admin-upload-url").handler);
