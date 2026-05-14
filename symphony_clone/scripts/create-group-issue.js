#!/usr/bin/env node
'use strict';

// Create a Linear "harness group" issue that symphony_clone's orchestrator
// will pick up. Idempotent: skips creation when an issue with the same
// group_id already exists in the configured project.
//
// Usage:
//   node scripts/create-group-issue.js --group B --stories "E2-S1,E2-S2" --title "Search feature"
//   node scripts/create-group-issue.js --group C --stories "E3-S1" --title "UI" --depends-on A,B
//
// Required env (from .env): LINEAR_API_KEY, LINEAR_PROJECT_SLUG.
// Required flags: --group, --stories, --title.

const { loadConfig } = require('../src/config');

const FLAGS = parseArgs(process.argv.slice(2));
if (!FLAGS.group || !FLAGS.stories || !FLAGS.title) {
  console.error('Required: --group <ID> --stories "<S1,S2,..>" --title "<text>"');
  console.error('Optional: --depends-on <Group1,Group2>  --dry-run');
  process.exit(2);
}

async function main() {
  const config = loadConfig();
  const linear = new LinearClient(config.linear);

  const project = await linear.getProject(config.linear.projectSlug);
  const team = await linear.getTeamForProject(project.id);

  if (await linear.findIssueByGroup(project.id, FLAGS.group)) {
    console.log(`Group "${FLAGS.group}" already has an issue in project "${project.name}". Skipping.`);
    return;
  }

  const description = renderDescription({
    group: FLAGS.group,
    stories: FLAGS.stories.split(',').map((s) => s.trim()).filter(Boolean),
    title: FLAGS.title,
    dependsOn: (FLAGS.dependsOn || '').split(',').map((s) => s.trim()).filter(Boolean),
    teamKey: team.key
  });

  if (FLAGS.dryRun) {
    console.log(`DRY RUN — would create issue in project "${project.name}" (team ${team.key}):\n`);
    console.log(`  Title: ${FLAGS.title} (Group ${FLAGS.group})`);
    console.log(`  Labels: harness-e2e, harness-group, group-${FLAGS.group}, agent-ready`);
    console.log(`  State: ${config.tracker.readyState}`);
    console.log(`  Description:\n${indent(description, 4)}`);
    return;
  }

  const labelIds = await linear.ensureLabels(team.id, ['harness-e2e', 'harness-group', `group-${FLAGS.group}`, 'agent-ready']);
  const stateId = await linear.findStateId(config.tracker.readyState);

  const created = await linear.createIssue({
    teamId: team.id,
    projectId: project.id,
    title: `${FLAGS.title} (Group ${FLAGS.group})`,
    description,
    stateId,
    labelIds
  });

  console.log(`Created ${created.identifier}: ${created.url}`);
}

function renderDescription({ group, stories, title, dependsOn, teamKey }) {
  const lines = [
    '## Harness Group',
    '',
    `* Group: ${group}`,
    `* Harness command: /auto --group ${group}`,
    `* Stories: ${stories.join(', ')}`,
    `* Depends on groups: ${dependsOn.length ? dependsOn.join(', ') : 'none'}`,
    `* Labels: harness-group, group-${group}, agent-ready, harness-e2e`,
    `* Team: ${teamKey}`,
    '',
    `## Summary`,
    '',
    title
  ];
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function indent(text, n) {
  const pad = ' '.repeat(n);
  return text.split('\n').map((line) => pad + line).join('\n');
}

class LinearClient {
  constructor(linearConfig) {
    this.apiUrl = linearConfig.apiUrl;
    this.apiKey = linearConfig.apiKey;
  }

  async graphql(query, variables) {
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: { Authorization: this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Linear HTTP ${response.status}: ${body}`);
    }
    const payload = await response.json();
    if (payload.errors && payload.errors.length > 0) {
      throw new Error(`Linear GraphQL error: ${payload.errors.map((e) => e.message).join('; ')}`);
    }
    return payload.data;
  }

  async getProject(slug) {
    const data = await this.graphql(
      'query($slug: String!) { projects(filter:{slugId:{eq:$slug}}) { nodes { id name } } }',
      { slug }
    );
    const project = data.projects.nodes[0];
    if (!project) throw new Error(`Project not found for slug: ${slug}`);
    return project;
  }

  async getTeamForProject(projectId) {
    const data = await this.graphql(
      'query($id: String!) { project(id:$id) { teams(first:1) { nodes { id key } } } }',
      { id: projectId }
    );
    const team = data.project.teams.nodes[0];
    if (!team) throw new Error(`No team found for project ${projectId}`);
    return team;
  }

  async findIssueByGroup(projectId, group) {
    const data = await this.graphql(
      'query($pid: ID!, $label: String!) { issues(first:1, filter:{project:{id:{eq:$pid}}, labels:{name:{eq:$label}}}) { nodes { id identifier } } }',
      { pid: projectId, label: `group-${group}` }
    );
    return data.issues.nodes[0] || null;
  }

  async findStateId(stateName) {
    const data = await this.graphql(
      'query { workflowStates(first:100) { nodes { id name } } }',
      {}
    );
    const state = data.workflowStates.nodes.find(
      (s) => s.name.toLowerCase() === stateName.toLowerCase()
    );
    if (!state) {
      throw new Error(`Workflow state not found: ${stateName} (available: ${data.workflowStates.nodes.map((s) => s.name).join(', ')})`);
    }
    return state.id;
  }

  async ensureLabels(teamId, names) {
    const data = await this.graphql(
      'query($teamId: String!) { team(id:$teamId) { labels(first:200) { nodes { id name } } } }',
      { teamId }
    );
    const existing = new Map(data.team.labels.nodes.map((l) => [l.name.toLowerCase(), l.id]));
    const ids = [];
    for (const name of names) {
      const found = existing.get(name.toLowerCase());
      if (found) {
        ids.push(found);
        continue;
      }
      const created = await this.graphql(
        'mutation($name: String!, $teamId: String!) { issueLabelCreate(input:{name:$name, teamId:$teamId}) { issueLabel { id } } }',
        { name, teamId }
      );
      ids.push(created.issueLabelCreate.issueLabel.id);
    }
    return ids;
  }

  async createIssue({ teamId, projectId, title, description, stateId, labelIds }) {
    const data = await this.graphql(
      `mutation($input: IssueCreateInput!) {
         issueCreate(input: $input) { issue { id identifier url } }
       }`,
      {
        input: { teamId, projectId, title, description, stateId, labelIds }
      }
    );
    return data.issueCreate.issue;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
