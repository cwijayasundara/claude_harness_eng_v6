'use strict';

const { loadConfig } = require('../src/config');

async function main() {
  const config = loadConfig();
  const { apiUrl, apiKey, projectSlug } = config.linear;

  const query = `
    query Diagnose($slug: String!) {
      projects(filter: { slugId: { eq: $slug } }) {
        nodes {
          id
          name
          slugId
          state
        }
      }
      issues(first: 100, filter: { project: { slugId: { eq: $slug } } }) {
        nodes {
          identifier
          title
          state { name }
        }
      }
    }
  `;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { Authorization: apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { slug: projectSlug } })
  });

  const text = await response.text();
  if (!response.ok) {
    console.error(`HTTP ${response.status}: ${text}`);
    process.exit(1);
  }

  const payload = JSON.parse(text);
  if (payload.errors) {
    console.error('GraphQL errors:', JSON.stringify(payload.errors, null, 2));
    process.exit(1);
  }

  const projects = payload.data.projects.nodes;
  const issues = payload.data.issues.nodes;

  console.log(`Looking up slugId="${projectSlug}"`);
  console.log(`Projects matched: ${projects.length}`);
  for (const project of projects) {
    console.log(`  - ${project.name} (slugId=${project.slugId}, state=${project.state})`);
  }

  console.log(`\nIssues in project: ${issues.length}`);
  const counts = new Map();
  for (const issue of issues) {
    const state = issue.state ? issue.state.name : '(none)';
    counts.set(state, (counts.get(state) || 0) + 1);
  }
  for (const [state, count] of counts) {
    console.log(`  ${state}: ${count}`);
  }

  console.log(`\nWatching for states: "${config.tracker.readyState}", "${config.tracker.runningState}"`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
