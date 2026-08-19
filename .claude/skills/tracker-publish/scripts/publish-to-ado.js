'use strict';

// publish-to-ado.js — create or update Azure DevOps work items from tracker-map.json.
// Injectable request so tests do not hit the network.

const fs = require('node:fs');
const path = require('node:path');

const API_VERSION = '7.1';

function looksAlreadyPublished(group) {
  if (!group.tracker_key) return false;
  if (['pending-remote-publish', 'pending_remote_publish'].includes(group.tracker_id)) return false;
  if (['pending-remote-publish', 'pending_remote_publish'].includes(group.url)) return false;
  if (/^[A-Z]+-LOCAL-/.test(String(group.tracker_key))) return false;
  return /^\d+$/.test(String(group.tracker_key));
}

function markdownToHtml(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      const escaped = line
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return escaped.length ? `<p>${escaped}</p>` : '<p></p>';
    })
    .join('');
}

function createPatch(title, html, tags) {
  const ops = [
    { op: 'add', path: '/fields/System.Title', value: title },
    { op: 'add', path: '/fields/System.Description', value: html },
  ];
  if (tags && tags.length) {
    ops.push({ op: 'add', path: '/fields/System.Tags', value: tags.join('; ') });
  }
  return ops;
}

function workItemUrl(config, id) {
  const org = String(config.orgUrl || '').replace(/\/$/, '');
  const project = encodeURIComponent(config.project);
  return `${org}/${project}/_workitems/edit/${id}`;
}

function updateTrackerReferences(trackerMap, config, group, groupId, item) {
  const id = item.id;
  group.tracker_key = String(id);
  group.tracker_id = String(id);
  group.url = workItemUrl(config, id);
  for (const sid of group.stories || []) {
    if (trackerMap.stories && trackerMap.stories[sid]) {
      trackerMap.stories[sid].tracker_key = String(id);
    }
  }
  return { groupId, key: String(id), url: group.url };
}

async function publishGroups(trackerMap, config, deps) {
  const { request, readBody, dryRun = false } = deps;
  const created = [];
  const updated = [];
  const skipped = [];
  const type = encodeURIComponent(config.workItemType || 'Task');

  for (const [groupId, group] of Object.entries(trackerMap.groups || {})) {
    const title = group.title || `Group ${groupId}`;
    const body = readBody(group, groupId);
    const html = markdownToHtml(body);
    const tags = group.labels || [];

    if (dryRun) {
      created.push({ groupId, dryRun: true, update: looksAlreadyPublished(group) });
      continue;
    }

    if (looksAlreadyPublished(group)) {
      const id = group.tracker_key;
      await request(
        'PATCH',
        `/_apis/wit/workitems/${id}?api-version=${API_VERSION}`,
        createPatch(title, html, tags),
      );
      const entry = updateTrackerReferences(trackerMap, config, group, groupId, { id });
      updated.push(entry);
      continue;
    }

    const item = await request(
      'POST',
      `/_apis/wit/workitems/$${type}?api-version=${API_VERSION}`,
      createPatch(title, html, tags),
    );
    const entry = updateTrackerReferences(trackerMap, config, group, groupId, item);
    created.push(entry);
  }
  return { created, updated, skipped };
}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--project-root') out.projectRoot = argv[++i];
  }
  return out;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function makeAdoRequest({ orgUrl, pat }) {
  const auth = Buffer.from(`:${pat}`).toString('base64');
  const base = String(orgUrl).replace(/\/$/, '');
  return async function request(method, p, body) {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json',
        'Content-Type': 'application/json-patch+json',
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Azure DevOps ${method} ${p} → ${res.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  };
}

function buildConfig(trackerMap, trackerConfig) {
  const t = trackerConfig.tracker || {};
  const azure = trackerConfig.azure || t.azure || {};
  return {
    orgUrl: process.env.AZURE_DEVOPS_ORG_URL || azure.org_url || t.org_url,
    project: azure.project || t.project || t.project_key,
    workItemType: t.issue_type || azure.work_item_type || 'Task',
  };
}

function validateConfig(config) {
  if (!config.orgUrl || !config.project || /^replace-with-/.test(String(config.project))) {
    throw new Error('tracker.org_url (or azure.org_url) and project must be set in .claude/tracker-config.json.');
  }
  const pat = process.env.AZURE_DEVOPS_PAT || process.env.AZURE_DEVOPS_TOKEN;
  if (!pat) throw new Error('AZURE_DEVOPS_PAT must be set in the environment.');
  return { pat };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.projectRoot || process.cwd();
  const trackerMap = readJson(path.join(projectRoot, '.claude/state/tracker-map.json'));
  const trackerConfig = readJson(path.join(projectRoot, '.claude/tracker-config.json'));
  const config = buildConfig(trackerMap, trackerConfig);
  const { pat } = validateConfig(config);
  const request = makeAdoRequest({ orgUrl: config.orgUrl, pat });
  const readBody = (group, groupId) => fs.readFileSync(
    path.join(projectRoot, group.body_file || `.claude/state/tracker-runs/group-${groupId}.md`),
    'utf8',
  );
  const { created, updated } = await publishGroups(trackerMap, config, {
    request, readBody, dryRun: args.dryRun,
  });
  if ((created.length || updated.length) && !args.dryRun) trackerMap.status = 'published';
  trackerMap.published_at = new Date().toISOString();
  if (!args.dryRun) {
    fs.writeFileSync(
      path.join(projectRoot, '.claude/state/tracker-map.json'),
      `${JSON.stringify(trackerMap, null, 2)}\n`,
    );
  }
  console.log(`Summary: created=${created.length} updated=${updated.length}`);
  for (const c of created) console.log(`  + ${c.groupId}: ${c.dryRun ? '(dry-run)' : `${c.key} ${c.url}`}`);
  for (const u of updated) console.log(`  ~ ${u.groupId}: ${u.key}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = {
  publishGroups, looksAlreadyPublished, markdownToHtml, createPatch, buildConfig,
};
