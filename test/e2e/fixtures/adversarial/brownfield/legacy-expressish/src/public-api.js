'use strict';

const { route } = require('./router');

function handle(method, url) {
  return route({ method, url });
}

module.exports = { handle };
