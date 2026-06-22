'use strict';

// Azure DevOps (Boards) REST adapter. Implements the same duck-typed contract as
// the Linear/Jira adapters. Azure has no GraphQL and no per-issue "key": work items
// are addressed by numeric id, "labels" are tags (semicolon-separated), and "state"
// is the System.State field. Listing is two-phase (WIQL -> work-item batch); blocker
// states need a second batch because relations carry only a url, not the state.

const { restRequest, basicAuth, unique } = require('./http');

const API_VERSION = '7.1';
const COMMENTS_API_VERSION = '7.1-preview.3';
const BLOCKED_BY_REL = 'System.LinkTypes.Dependency-Reverse'; // predecessor blocks this item

class AzureDevOpsTracker {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async listCandidates() {
    const ids = await this.queryCandidateIds();
    if (ids.length === 0) return [];
    const items = await this.getWorkItems(ids, true);
    const blockerStates = await this.resolveBlockerStates(items);
    return items.map((item) => normalizeAzureItem(item, this.config.azure, blockerStates));
  }

  async queryCandidateIds() {
    const states = [this.config.tracker.readyState, this.config.tracker.runningState];
    const inList = states.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(', ');
    const query = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.State] IN (${inList})`;
    const data = await this.request('POST', `/_apis/wit/wiql?api-version=${API_VERSION}`, { query });
    return (data.workItems || []).map((w) => w.id);
  }

  async getWorkItems(ids, withRelations) {
    const detail = withRelations ? '&$expand=relations' : '&fields=System.State';
    const data = await this.request('GET', `/_apis/wit/workitems?ids=${ids.join(',')}${detail}&api-version=${API_VERSION}`);
    return data.value || [];
  }

  async resolveBlockerStates(items) {
    const ids = unique(items.flatMap((item) => blockerIdsFromRelations(item.relations || [])));
    const map = new Map();
    if (ids.length === 0) return map;
    const blockers = await this.getWorkItems(ids, false);
    for (const blocker of blockers) map.set(blocker.id, blocker.fields && blocker.fields['System.State']);
    return map;
  }

  async moveIssue(issueId, stateName, fallbackNames = []) {
    const names = unique([stateName, ...fallbackNames]);
    let lastError = null;
    for (const name of names) {
      try {
        await this.patchState(issueId, name);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Azure DevOps could not set state for work item ${issueId} (tried: ${names.join(', ')}): ${lastError && lastError.message}`);
  }

  async patchState(issueId, stateName) {
    await this.request(
      'PATCH',
      `/_apis/wit/workitems/${issueId}?api-version=${API_VERSION}`,
      [{ op: 'add', path: '/fields/System.State', value: stateName }],
      'application/json-patch+json'
    );
  }

  async addComment(issueId, body) {
    await this.request('POST', `/_apis/wit/workItems/${issueId}/comments?api-version=${COMMENTS_API_VERSION}`, { text: body });
  }

  request(method, path, body, contentType = 'application/json') {
    return restRequest(this.fetchImpl, `${this.config.azure.baseUrl}${path}`, {
      method,
      body,
      contentType,
      headers: { Authorization: `Basic ${basicAuth('', this.config.azure.pat)}` },
      errorLabel: `Azure DevOps ${method} ${path}`
    });
  }
}

function normalizeAzureItem(item, azure, blockerStates) {
  const fields = item.fields || {};
  const id = item.id;
  return {
    id,
    key: String(id),
    title: fields['System.Title'] || '',
    description: htmlToText(fields['System.Description'] || ''),
    url: `${azure.orgUrl}/${encodeURIComponent(azure.project)}/_workitems/edit/${id}`,
    branchName: null,
    priority: fields['Microsoft.VSTS.Common.Priority'] != null ? fields['Microsoft.VSTS.Common.Priority'] : null,
    state: fields['System.State'],
    labels: parseTags(fields['System.Tags']),
    blockedBy: blockerIdsFromRelations(item.relations || []).map((blockerId) => ({
      id: blockerId,
      key: String(blockerId),
      state: blockerStates.get(blockerId) || null
    }))
  };
}

function blockerIdsFromRelations(relations) {
  return relations
    .filter((rel) => rel.rel === BLOCKED_BY_REL)
    .map((rel) => workItemIdFromUrl(rel.url))
    .filter((id) => id !== null);
}

function workItemIdFromUrl(url) {
  const match = /\/workItems\/(\d+)/i.exec(url || '');
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseTags(tags) {
  if (!tags) return [];
  return String(tags).split(';').map((tag) => tag.trim()).filter(Boolean);
}

function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = { AzureDevOpsTracker, normalizeAzureItem };
