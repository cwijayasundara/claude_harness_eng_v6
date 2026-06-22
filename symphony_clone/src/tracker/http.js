'use strict';

// Shared REST helpers for the token-authenticated tracker adapters (Jira, Azure
// DevOps). The Linear adapter speaks GraphQL and keeps its own client. Centralizing
// the request wrapper keeps auth/ok-check/204/JSON handling identical across REST
// providers and bounds the response body folded into thrown errors in ONE place
// (those errors reach operator logs and tracker comments).

const MAX_ERROR_BODY = 500;

async function restRequest(fetchImpl, url, { method, headers = {}, body, contentType = 'application/json', errorLabel = 'request' }) {
  const finalHeaders = { Accept: 'application/json', ...headers };
  const init = { method, headers: finalHeaders };
  if (body !== undefined) {
    finalHeaders['Content-Type'] = contentType;
    init.body = JSON.stringify(body);
  }
  const response = await fetchImpl(url, init);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${errorLabel} failed with HTTP ${response.status}: ${truncate(text, MAX_ERROR_BODY)}`);
  }
  if (response.status === 204) return {};
  return response.json().catch(() => ({}));
}

function basicAuth(user, token) {
  return Buffer.from(`${user}:${token}`).toString('base64');
}

function truncate(text, max = MAX_ERROR_BODY) {
  const value = String(text == null ? '' : text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

// Dedupe while preserving falsy-but-meaningful values (0, ''); only null/undefined
// are dropped, so numeric work-item ids survive.
function unique(values) {
  return [...new Set(values.filter((value) => value !== null && value !== undefined))];
}

module.exports = { restRequest, basicAuth, truncate, normalize, unique };
