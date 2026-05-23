#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args.projectRoot || process.cwd());
const trackerMapPath = path.join(projectRoot, '.claude/state/tracker-map.json');
const trackerConfigPath = path.join(projectRoot, '.claude/tracker-config.json');
const envPath = args.envFile ? path.resolve(args.envFile) : path.join(projectRoot, '.env');

main().catch((err) => {
  console.error(`\n✖ publish-to-linear failed: ${err.message}`);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});

async function main() {
  loadEnvFile(envPath);
  const apiKey = process.env.LINEAR_API_KEY;
  if (!apiKey) {
    throw new Error(`LINEAR_API_KEY not set (looked in ${envPath} and shell env). Set it before running.`);
  }
  if (!fs.existsSync(trackerMapPath)) {
    throw new Error(`tracker-map.json not found at ${trackerMapPath}. Run /tracker-publish first.`);
  }
  const trackerMap = readJson(trackerMapPath);
  const trackerConfig = fs.existsSync(trackerConfigPath) ? readJson(trackerConfigPath) : {};

  const projectSlug = (trackerMap.config_snapshot && trackerMap.config_snapshot.project_slug)
    || (trackerConfig.tracker && trackerConfig.tracker.project_slug);
  if (!projectSlug || projectSlug.startsWith('replace-with-')) {
    throw new Error(`project_slug missing or placeholder. Set tracker.project_slug in tracker-config.json or update tracker-map.json.`);
  }

  const apiUrl = process.env.LINEAR_API_URL || 'https://api.linear.app/graphql';
  const graphql = makeLinearClient({ apiKey, apiUrl });

  console.log(`→ Linear API: ${apiUrl}`);
  console.log(`→ Project slug: ${projectSlug}`);

  const project = await findProject(graphql, projectSlug);
  console.log(`✓ Project: ${project.name} (id=${project.id})`);

  const teamId = pickTeamId(project, trackerConfig);
  console.log(`✓ Team id=${teamId}`);

  const readyState = (trackerMap.config_snapshot && trackerMap.config_snapshot.ready_state)
    || (trackerConfig.tracker && trackerConfig.tracker.ready_state)
    || 'Todo';
  const stateId = await findStateId(graphql, teamId, readyState);
  console.log(`✓ State "${readyState}" → ${stateId}`);

  const labelCache = new Map((await listTeamLabels(graphql, teamId)).map((l) => [l.name.toLowerCase(), l.id]));

  const created = [];
  const skipped = [];

  for (const [groupId, group] of Object.entries(trackerMap.groups || {})) {
    if (looksAlreadyPublished(group)) {
      skipped.push({ groupId, key: group.tracker_key });
      continue;
    }
    const bodyFile = path.join(projectRoot, group.body_file || `.claude/state/tracker-runs/group-${groupId}.md`);
    if (!fs.existsSync(bodyFile)) throw new Error(`body_file missing: ${bodyFile}`);
    const body = fs.readFileSync(bodyFile, 'utf8');
    const labelIds = await resolveLabels(graphql, teamId, group.labels || [], labelCache);

    if (args.dryRun) {
      console.log(`[dry-run] Would create issue for group ${groupId}: "${group.title}"`);
      created.push({ groupId, dryRun: true });
      continue;
    }

    const issue = await createIssue(graphql, {
      teamId, projectId: project.id,
      title: group.title || `Group ${groupId}`,
      description: body, stateId, labelIds
    });
    console.log(`✓ Created ${issue.identifier} → ${issue.url}`);
    group.tracker_key = issue.identifier;
    group.tracker_id = issue.id;
    group.url = issue.url;
    for (const sid of group.stories || []) {
      if (trackerMap.stories && trackerMap.stories[sid]) trackerMap.stories[sid].tracker_key = issue.identifier;
    }
    created.push({ groupId, key: issue.identifier, url: issue.url });
  }

  if (created.length && !args.dryRun) trackerMap.status = 'published';
  trackerMap.published_at = new Date().toISOString();

  if (!args.dryRun) {
    fs.writeFileSync(trackerMapPath, JSON.stringify(trackerMap, null, 2) + '\n');
    console.log(`✓ Updated ${trackerMapPath}`);
  }

  console.log(`\nSummary: created=${created.length} skipped=${skipped.length}`);
  for (const c of created) console.log(`  + ${c.groupId}: ${c.dryRun ? '(dry-run)' : `${c.key} ${c.url}`}`);
  for (const s of skipped) console.log(`  = ${s.groupId}: already published (${s.key})`);
}

function looksAlreadyPublished(group) {
  if (!group.tracker_key) return false;
  if (['pending-remote-publish', 'pending_remote_publish'].includes(group.tracker_id)) return false;
  if (['pending-remote-publish', 'pending_remote_publish'].includes(group.url)) return false;
  if (/^[A-Z]+-LOCAL-/.test(group.tracker_key)) return false;
  return true;
}

function makeLinearClient({ apiKey, apiUrl }) {
  return async function graphql(query, variables) {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Linear HTTP ${res.status}: ${text.slice(0, 500)}`);
    let payload;
    try { payload = JSON.parse(text); } catch (_) { throw new Error(`Linear non-JSON: ${text.slice(0, 200)}`); }
    if (payload.errors && payload.errors.length) throw new Error(`Linear GraphQL: ${payload.errors.map((e) => e.message).join('; ')}`);
    return payload.data;
  };
}

async function findProject(graphql, slug) {
  const data = await graphql(`query($slug:String!){projects(filter:{slugId:{eq:$slug}},first:1){nodes{id name teams(first:5){nodes{id key name}}}}}`, { slug });
  const node = data.projects && data.projects.nodes && data.projects.nodes[0];
  if (!node) throw new Error(`No Linear project with slug "${slug}"`);
  return node;
}

function pickTeamId(project, trackerConfig) {
  const teams = (project.teams && project.teams.nodes) || [];
  if (!teams.length) throw new Error(`Project "${project.name}" has no teams`);
  const wanted = trackerConfig.tracker && trackerConfig.tracker.team_key;
  if (wanted) {
    const m = teams.find((t) => t.key === wanted);
    if (m) return m.id;
    console.warn(`! team_key "${wanted}" not found; using first team "${teams[0].key}"`);
  }
  return teams[0].id;
}

async function findStateId(graphql, teamId, name) {
  const data = await graphql(`query($id:String!){team(id:$id){states(first:50){nodes{id name}}}}`, { id: teamId });
  const states = (data.team && data.team.states && data.team.states.nodes) || [];
  const w = name.trim().toLowerCase();
  const m = states.find((s) => s.name.trim().toLowerCase() === w);
  if (!m) throw new Error(`No state "${name}". Available: ${states.map((s) => s.name).join(', ')}`);
  return m.id;
}

async function listTeamLabels(graphql, teamId) {
  const data = await graphql(`query($id:String!){team(id:$id){labels(first:200){nodes{id name}}}}`, { id: teamId });
  return (data.team && data.team.labels && data.team.labels.nodes) || [];
}

async function resolveLabels(graphql, teamId, names, cache) {
  const ids = [];
  for (const name of names) {
    const k = name.toLowerCase();
    if (cache.has(k)) { ids.push(cache.get(k)); continue; }
    const data = await graphql(`mutation($t:String!,$n:String!){issueLabelCreate(input:{teamId:$t,name:$n}){success issueLabel{id name}}}`, { t: teamId, n: name });
    const label = data.issueLabelCreate && data.issueLabelCreate.issueLabel;
    if (!label) throw new Error(`Failed to create label "${name}"`);
    cache.set(k, label.id);
    ids.push(label.id);
  }
  return ids;
}

async function createIssue(graphql, { teamId, projectId, title, description, stateId, labelIds }) {
  const data = await graphql(`mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{id identifier url title}}}`, {
    input: { teamId, projectId, title, description, stateId, labelIds }
  });
  if (!data.issueCreate || !data.issueCreate.success) throw new Error(`issueCreate success=false`);
  return data.issueCreate.issue;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, k, rv] = m;
    let v = rv.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else { const i = v.indexOf(' #'); if (i !== -1) v = v.slice(0, i).trim(); }
    if (!Object.prototype.hasOwnProperty.call(process.env, k) || process.env[k] === '') {
      process.env[k] = v.replace(/\\n/g, '\n');
    }
  }
}

function parseArgs(argv) {
  const out = { dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') out.dryRun = true;
    else if (a === '--project-root') out.projectRoot = argv[++i];
    else if (a === '--env-file') out.envFile = argv[++i];
    else if (a === '--help' || a === '-h') { printUsage(); process.exit(0); }
  }
  return out;
}

function printUsage() {
  console.log(`Usage: node publish-to-linear.js [--dry-run] [--project-root <path>] [--env-file <path>]

Reads .claude/state/tracker-map.json and creates Linear issues for every group
whose tracker_id is still the local placeholder. Updates the map in place with
real tracker_key/tracker_id/url values.

LINEAR_API_KEY must be set in <project-root>/.env or shell. .env loader does
not override existing shell values.`);
}
