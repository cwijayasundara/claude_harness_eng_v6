'use strict';

// Jira Cloud REST adapter. Implements the same duck-typed contract as the Linear
// adapter: listCandidates / moveIssue(id, name, fallbacks) / addComment(id, body),
// returning the normalized issue shape the scheduler consumes. Jira v3 bodies use
// the Atlassian Document Format (ADF), so description is flattened to text on the
// way in and comment text is wrapped in ADF on the way out.

const { restRequest, basicAuth, normalize, unique } = require('./http');

const SEARCH_FIELDS = ['summary', 'description', 'status', 'labels', 'issuelinks', 'priority'];

class JiraTracker {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async listCandidates() {
    const states = [this.config.tracker.readyState, this.config.tracker.runningState];
    const jql = `project = ${quoteJql(this.config.jira.projectKey)} AND status in (${states.map(quoteJql).join(', ')})`;
    const data = await this.request('POST', '/rest/api/3/search/jql', { jql, maxResults: 50, fields: SEARCH_FIELDS });
    return (data.issues || []).map((issue) => normalizeJiraIssue(issue, this.config.jira.baseUrl));
  }

  async moveIssue(issueId, stateName, fallbackNames = []) {
    const transition = await this.findTransition(issueId, stateName, fallbackNames);
    await this.request('POST', `/rest/api/3/issue/${issueId}/transitions`, { transition: { id: transition.id } });
  }

  async addComment(issueId, body) {
    await this.request('POST', `/rest/api/3/issue/${issueId}/comment`, { body: textToAdf(body) });
  }

  async findTransition(issueId, stateName, fallbackNames = []) {
    const data = await this.request('GET', `/rest/api/3/issue/${issueId}/transitions`);
    const transitions = data.transitions || [];
    const names = unique([stateName, ...fallbackNames]);
    const wanted = names.map(normalize);
    const match = transitions.find((t) => wanted.includes(normalize(t.to && t.to.name)));
    if (!match) {
      const available = transitions.map((t) => t.to && t.to.name).filter(Boolean).sort().join(', ');
      throw new Error(`Jira transition to state not found: ${stateName} (tried: ${names.join(', ')}; available targets: ${available})`);
    }
    return match;
  }

  request(method, path, body) {
    return restRequest(this.fetchImpl, `${this.config.jira.baseUrl}${path}`, {
      method,
      body,
      headers: { Authorization: `Basic ${basicAuth(this.config.jira.email, this.config.jira.apiToken)}` },
      errorLabel: `Jira ${method} ${path}`
    });
  }
}

function normalizeJiraIssue(issue, baseUrl) {
  const fields = issue.fields || {};
  return {
    id: issue.id,
    key: issue.key,
    title: fields.summary || '',
    description: adfToText(fields.description),
    url: baseUrl ? `${baseUrl}/browse/${issue.key}` : null,
    branchName: null,
    priority: (fields.priority && fields.priority.name) || null,
    state: fields.status && fields.status.name,
    labels: fields.labels || [],
    blockedBy: blockedByFromLinks(fields.issuelinks || [])
  };
}

// On a blocked issue, the "Blocks" link surfaces the blocking issue as inwardIssue
// ("is blocked by"). The outward side means THIS issue blocks the other, which must
// not gate it — so only inward links count as blockers.
function blockedByFromLinks(links) {
  return links
    .filter((link) => link.inwardIssue && /block/i.test((link.type && link.type.name) || ''))
    .map((link) => ({
      id: link.inwardIssue.id,
      key: link.inwardIssue.key,
      state: link.inwardIssue.fields && link.inwardIssue.fields.status && link.inwardIssue.fields.status.name
    }));
}

function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node.trim();
  const parts = [];
  walkAdf(node, parts);
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
}

function walkAdf(node, parts) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'text' && typeof node.text === 'string') parts.push(node.text);
  if (node.type === 'hardBreak') parts.push('\n');
  if (Array.isArray(node.content)) {
    node.content.forEach((child) => walkAdf(child, parts));
    if (node.type === 'paragraph' || node.type === 'heading') parts.push('\n');
  }
}

function textToAdf(text) {
  const content = String(text == null ? '' : text).split('\n').map((line) => ({
    type: 'paragraph',
    content: line.length ? [{ type: 'text', text: line }] : []
  }));
  return { type: 'doc', version: 1, content };
}

function quoteJql(value) {
  return `"${String(value).replace(/(["\\])/g, '\\$1')}"`;
}

module.exports = { JiraTracker, normalizeJiraIssue, adfToText, textToAdf };
