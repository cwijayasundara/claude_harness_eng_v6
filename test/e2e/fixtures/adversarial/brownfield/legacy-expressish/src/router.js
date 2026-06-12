'use strict';

const tickets = new Map([
  ['T-100', { id: 'T-100', title: 'Printer offline', priority: 'low' }],
  ['T-200', { id: 'T-200', title: 'VPN unavailable', priority: 'high' }],
]);

function json(status, body) {
  return { status, body };
}

function route(req) {
  if (req.method === 'GET' && req.url === '/health') {
    return json(200, { ok: true, version: '1' });
  }

  const match = /^\/tickets\/([^/]+)$/.exec(req.url);
  if (req.method === 'GET' && match) {
    const ticket = tickets.get(match[1]);
    if (!ticket) return json(404, { code: 'NOT_FOUND' });
    return json(200, { data: ticket, meta: { apiVersion: '1' } });
  }

  return json(404, { code: 'NOT_FOUND' });
}

module.exports = { route };
