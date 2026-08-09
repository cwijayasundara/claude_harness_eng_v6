'use strict';

// Inbound tracker read: fetch one ticket by key and normalise it.
//
// The harness could always PUSH to a tracker (tracker-publish writes Linear /
// Jira issues from an approved dependency graph) but never PULL from one. For a
// team working *from* a tracker — the most common professional entry point —
// that meant copying ticket text into `/change "<description>"` by hand, and the
// resulting story carried no link back to the ticket. Provenance existed in one
// direction only.
//
// This is deliberately READ-ONLY. Nothing here transitions, comments on, or
// closes a ticket: `/change` opens a PR and a human merges it, so a harness that
// moved tickets would be asserting an outcome it does not control.
//
// Normalised shape (both providers):
//   { provider, key, url, title, description, acceptance[], labels[], state }

const fs = require('fs');

const LINEAR_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const JIRA_KEY = /^[A-Z][A-Z0-9]+-\d+$/;

// Acceptance criteria in a ticket body are prose, not schema. These are the
// shapes teams actually use; anything unmatched stays in `description` rather
// than being dropped, because a criterion silently lost here becomes a
// requirement nobody tests.
const AC_HEADING = /^#{1,4}\s*(acceptance\s*criteria|acceptance|AC)\s*:?\s*$/i;
const AC_INLINE = /^\s*(?:[-*]|\d+\.)\s*(?:\*\*)?(?:AC\d*|Given)\b/i;
const BULLET = /^\s*(?:[-*]|\d+\.)\s+(.*)$/;

/** Load KEY=value pairs from a .env file without clobbering the real environment. */
function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else { const i = v.indexOf(' #'); if (i !== -1) v = v.slice(0, i).trim(); }
    if (!process.env[m[1]]) process.env[m[1]] = v.replace(/\\n/g, '\n');
  }
}

/** Pull acceptance-criteria bullets out of a ticket body. */
function extractAcceptance(body) {
  const out = [];
  let inSection = false;
  for (const line of String(body || '').split(/\r?\n/)) {
    if (AC_HEADING.test(line)) { inSection = true; continue; }
    if (inSection && /^#{1,4}\s+\S/.test(line)) { inSection = false; continue; }
    const bullet = line.match(BULLET);
    if (!bullet) continue;
    if (inSection || AC_INLINE.test(line)) out.push(bullet[1].trim());
  }
  return out;
}

async function fetchLinear(key, { apiKey, apiUrl }) {
  const query = `query($id: String!) { issue(id: $id) {
    identifier title description url state { name } labels { nodes { name } } } }`;
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { id: key } }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Linear ${res.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  if (body.errors) throw new Error(`Linear: ${body.errors.map((e) => e.message).join('; ')}`);
  const issue = body.data && body.data.issue;
  if (!issue) throw new Error(`Linear issue ${key} not found`);
  return {
    provider: 'linear',
    key: issue.identifier,
    url: issue.url,
    title: issue.title,
    description: issue.description || '',
    acceptance: extractAcceptance(issue.description),
    labels: ((issue.labels && issue.labels.nodes) || []).map((l) => l.name),
    state: (issue.state && issue.state.name) || null,
  };
}

// Jira Cloud returns a description as Atlassian Document Format, not markdown.
// Walking it for text nodes is enough for a story seed; losing the formatting is
// acceptable, losing the words is not.
function adfToText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text || '';
  const inner = (node.content || []).map(adfToText).join('');
  return ['paragraph', 'heading', 'listItem'].includes(node.type) ? `${inner}\n` : inner;
}

async function fetchJira(key, { baseUrl, email, token }) {
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const base = String(baseUrl).replace(/\/$/, '');
  const res = await fetch(`${base}/rest/api/3/issue/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jira ${res.status}: ${text.slice(0, 300)}`);
  const issue = JSON.parse(text);
  const f = issue.fields || {};
  const description = typeof f.description === 'string' ? f.description : adfToText(f.description).trim();
  return {
    provider: 'jira',
    key: issue.key,
    url: `${base}/browse/${issue.key}`,
    title: f.summary || '',
    description,
    acceptance: extractAcceptance(description),
    labels: f.labels || [],
    state: (f.status && f.status.name) || null,
  };
}

/** Fetch and normalise one ticket. Throws with an actionable message on misconfiguration. */
async function fetchTicket(provider, key, env = process.env) {
  if (provider === 'linear') {
    if (!LINEAR_KEY.test(key)) throw new Error(`"${key}" is not a Linear issue key (expected e.g. ENG-123)`);
    if (!env.LINEAR_API_KEY) throw new Error('LINEAR_API_KEY not set (looked in <project-root>/.env and shell env)');
    return fetchLinear(key, {
      apiKey: env.LINEAR_API_KEY,
      apiUrl: env.LINEAR_API_URL || 'https://api.linear.app/graphql',
    });
  }
  if (provider === 'jira') {
    if (!JIRA_KEY.test(key)) throw new Error(`"${key}" is not a Jira issue key (expected e.g. PROJ-45)`);
    if (!env.JIRA_BASE_URL) throw new Error('JIRA_BASE_URL not set');
    if (!env.JIRA_EMAIL || !env.JIRA_API_TOKEN) throw new Error('JIRA_EMAIL and JIRA_API_TOKEN must be set');
    return fetchJira(key, { baseUrl: env.JIRA_BASE_URL, email: env.JIRA_EMAIL, token: env.JIRA_API_TOKEN });
  }
  throw new Error(`unknown provider "${provider}" (expected linear or jira)`);
}

/** The story seed `/change` Step S1 writes, with provenance back to the ticket. */
function toStorySeed(ticket) {
  const criteria = ticket.acceptance.length
    ? ticket.acceptance.map((c, i) => `${i + 1}. ${c}`).join('\n')
    : '_None stated in the ticket — author them with the human before writing code._';
  return [
    `# ${ticket.key} — ${ticket.title}`,
    '',
    `Source: [${ticket.key}](${ticket.url}) (${ticket.provider}${ticket.state ? `, ${ticket.state}` : ''})`,
    ticket.labels.length ? `Labels: ${ticket.labels.join(', ')}` : '',
    '',
    '## Problem',
    '',
    ticket.description.trim() || '_The ticket carried no description._',
    '',
    '## Acceptance criteria',
    '',
    criteria,
    '',
    '## Out of scope',
    '',
    '_Confirm with the human; the ticket did not say._',
    '',
  ].filter((l) => l !== null).join('\n');
}

module.exports = { fetchTicket, toStorySeed, extractAcceptance, adfToText, loadEnvFile, LINEAR_KEY, JIRA_KEY };
