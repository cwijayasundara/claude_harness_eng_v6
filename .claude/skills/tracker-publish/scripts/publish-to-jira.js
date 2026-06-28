'use strict';

// publish-to-jira.js — create groomed dependency-group issues on Jira from
// tracker-map.json, then transition each into the ready state. Self-contained
// (symphony_clone/ is not copied into target projects), mirroring
// publish-to-linear.js. publishGroups takes injectable request + readBody so the
// core unit-tests without network or fs.

const fs = require('node:fs');
const path = require('node:path');

function textToAdf(text) {
  const content = String(text == null ? '' : text).split('\n').map((line) => ({
    type: 'paragraph',
    content: line.length ? [{ type: 'text', text: line }] : [],
  }));
  return { type: 'doc', version: 1, content };
}

function basicAuth(user, token) {
  return Buffer.from(`${user}:${token}`).toString('base64');
}

function looksAlreadyPublished(group) {
  if (!group.tracker_key) return false;
  if (['pending-remote-publish', 'pending_remote_publish'].includes(group.tracker_id)) return false;
  if (['pending-remote-publish', 'pending_remote_publish'].includes(group.url)) return false;
  if (/^[A-Z]+-LOCAL-/.test(group.tracker_key)) return false;
  return true;
}

function pickTransition(transitions, readyState) {
  const want = String(readyState || '').trim().toLowerCase();
  return (transitions || []).find((t) =>
    String(t.name || '').toLowerCase() === want
    || String((t.to && t.to.name) || '').toLowerCase() === want) || null;
}

async function createIssue(request, config, group, groupId, readBody) {
  const issue = await request('POST', '/rest/api/3/issue', {
    fields: {
      project: { key: config.projectKey },
      summary: group.title || `Group ${groupId}`,
      description: textToAdf(readBody(group, groupId)),
      issuetype: { name: config.issueType || 'Task' },
      labels: group.labels || [],
    },
  });
  return issue;
}

async function transitionIssue(request, config, issue) {
  const tdata = await request('GET', `/rest/api/3/issue/${issue.id}/transitions`);
  const transition = pickTransition(tdata && tdata.transitions, config.readyState);
  if (transition) {
    await request('POST', `/rest/api/3/issue/${issue.id}/transitions`, { transition: { id: transition.id } });
    return null;
  }
  return `group ${issue.groupId} (${issue.key}): no transition to "${config.readyState}" — move it manually`;
}

function updateTrackerReferences(trackerMap, config, group, groupId, issue) {
  const url = `${String(config.baseUrl).replace(/\/$/, '')}/browse/${issue.key}`;
  group.tracker_key = issue.key;
  group.tracker_id = issue.id;
  group.url = url;
  for (const sid of group.stories || []) {
    if (trackerMap.stories && trackerMap.stories[sid]) trackerMap.stories[sid].tracker_key = issue.key;
  }
  return { groupId, key: issue.key, url };
}

async function publishGroups(trackerMap, config, deps) {
  const { request, readBody, dryRun = false } = deps;
  const created = [];
  const skipped = [];
  const warnings = [];
  for (const [groupId, group] of Object.entries(trackerMap.groups || {})) {
    if (looksAlreadyPublished(group)) { skipped.push({ groupId, key: group.tracker_key }); continue; }
    if (dryRun) { created.push({ groupId, dryRun: true }); continue; }

    const issue = await createIssue(request, config, group, groupId, readBody);
    const warning = await transitionIssue(request, config, { ...issue, groupId });
    if (warning) warnings.push(warning);

    const entry = updateTrackerReferences(trackerMap, config, group, groupId, issue);
    created.push(entry);
  }
  return { created, skipped, warnings };
}

// ---- CLI ----

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

function makeJiraRequest({ baseUrl, email, token }) {
  const auth = basicAuth(email, token);
  const base = String(baseUrl).replace(/\/$/, '');
  return async function request(method, p, body) {
    const res = await fetch(`${base}${p}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body == null ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Jira ${method} ${p} → ${res.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : {};
  };
}

function buildConfig(projectRoot, trackerMap, trackerConfig) {
  const t = trackerConfig.tracker || {};
  return {
    baseUrl: process.env.JIRA_BASE_URL || t.base_url,
    projectKey: t.project_key,
    issueType: t.issue_type || 'Task',
    readyState: (trackerMap.config_snapshot && trackerMap.config_snapshot.ready_state) || t.ready_state || 'To Do',
  };
}

function validateConfig(config) {
  if (!config.baseUrl || !config.projectKey || /^replace-with-/.test(String(config.projectKey))) {
    throw new Error('tracker.base_url and tracker.project_key must be set in .claude/tracker-config.json.');
  }
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!email || !token) throw new Error('JIRA_EMAIL and JIRA_API_TOKEN must be set in the environment.');
  return { email, token };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.projectRoot || process.cwd();
  const trackerMap = readJson(path.join(projectRoot, '.claude/state/tracker-map.json'));
  const trackerConfig = readJson(path.join(projectRoot, '.claude/tracker-config.json'));
  const config = buildConfig(projectRoot, trackerMap, trackerConfig);
  const { email, token } = validateConfig(config);

  const request = makeJiraRequest({ baseUrl: config.baseUrl, email, token });
  const readBody = (group, groupId) => fs.readFileSync(
    path.join(projectRoot, group.body_file || `.claude/state/tracker-runs/group-${groupId}.md`), 'utf8');

  const { created, skipped, warnings } = await publishGroups(trackerMap, config, { request, readBody, dryRun: args.dryRun });

  if (created.length && !args.dryRun) trackerMap.status = 'published';
  trackerMap.published_at = new Date().toISOString();
  if (!args.dryRun) {
    fs.writeFileSync(path.join(projectRoot, '.claude/state/tracker-map.json'), JSON.stringify(trackerMap, null, 2) + '\n');
  }
  console.log(`Summary: created=${created.length} skipped=${skipped.length}`);
  for (const c of created) console.log(`  + ${c.groupId}: ${c.dryRun ? '(dry-run)' : `${c.key} ${c.url}`}`);
  for (const w of warnings) console.log(`  ! ${w}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`✗ ${err.message}`);
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { publishGroups, textToAdf, basicAuth, looksAlreadyPublished, pickTransition };
