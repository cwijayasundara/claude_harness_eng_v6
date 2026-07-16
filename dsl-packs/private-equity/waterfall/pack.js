const schema = require("./schema.json");
const { compile } = require("./compile");

const meta = {
  id: "pe-waterfall",
  domain: "private-equity",
  title: "PE Fund Distribution Waterfall",
  boundedContext: "Investment Decision & Returns"
};

module.exports = { meta, schema, compile };
