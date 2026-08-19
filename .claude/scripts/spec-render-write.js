#!/usr/bin/env node

'use strict';

// Deterministic expansion of stories.json into the rest of the story graph.
// spec-render writes the index (titles, ACs, edges); this script writes every
// derived file and runs the clusterer. One process, no per-file LLM turns.

const fs = require('fs');
const path = require('path');
const { planClusters } = require('./story-clusters');
const { renderStoryMd, renderEpics, renderGraphMd } = require('../hooks/lib/spec-render-format');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function asArray(v) { return Array.isArray(v) ? v : []; }

function parseGwt(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const m = raw.match(/^given\s+(.+?),\s*when\s+(.+?),\s*then\s+(.+)$/i);
  if (!m) return { given: raw || 'the system is ready', when: 'the action runs', then: raw || 'the outcome is observable' };
  return { given: m[1].trim(), when: m[2].trim(), then: m[3].trim() };
}

function storyAcs(story) {
  return asArray(story.acceptance_criteria).map((ac, i) => {
    if (typeof ac === 'string') {
      const gwt = parseGwt(ac);
      return { id: `${story.id}-AC${i + 1}`, ...gwt, traces: [] };
    }
    const gwt = ac.given ? ac : parseGwt(ac.text || ac.then || '');
    return {
      id: ac.id || `${story.id}-AC${i + 1}`,
      given: ac.given || gwt.given,
      when: ac.when || gwt.when,
      then: ac.then || gwt.then,
      traces: asArray(ac.traces),
    };
  });
}

function heavyReason(text) {
  const t = String(text || '').toLowerCase();
  if (/\bp95\b|\brps\b|requests per second|load test|60 seconds/.test(t)) return 'load';
  if (/10,?000|cryptographically|2\^40|csprng/.test(t)) return 'statistical';
  return null;
}

function categoryOf(ac) {
  const t = `${ac.given} ${ac.when} ${ac.then}`.toLowerCase();
  if (heavyReason(t) === 'load' || /performance|latency/.test(t)) return 'performance';
  if (/password|hash|cookie|ssrf|localhost|private|auth|crypto|401|422/.test(t)) return 'security';
  return 'functional';
}

function featureSteps(ac) {
  const thens = String(ac.then).split(/\s+and\s+/i).map((s) => s.trim()).filter(Boolean);
  return [`Given ${ac.given}`, `When ${ac.when}`, ...thens.map((s) => `Assert ${s}`)];
}

function topoGroups(stories) {
  const byId = new Map(stories.map((s) => [s.id, s]));
  const depth = new Map();
  function walk(id, stack) {
    if (depth.has(id)) return depth.get(id);
    if (stack.has(id)) return 0;
    stack.add(id);
    const deps = asArray(byId.get(id) && byId.get(id).depends_on)
      .map((d) => (typeof d === 'string' ? d : d.story))
      .filter((dep) => byId.has(dep));
    const n = deps.length ? Math.max(...deps.map((d) => walk(d, stack))) + 1 : 0;
    stack.delete(id);
    depth.set(id, n);
    return n;
  }
  stories.forEach((s) => walk(s.id, new Set()));
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const groups = [];
  for (const s of stories) {
    const letter = letters[depth.get(s.id) || 0];
    s.group = s.group || letter;
    let g = groups.find((x) => x.id === letter);
    if (!g) { g = { id: letter, stories: [], blockedBy: [] }; groups.push(g); }
    g.stories.push(s.id);
  }
  groups.sort((a, b) => a.id.localeCompare(b.id));
  for (let i = 1; i < groups.length; i += 1) {
    groups[i].blockedBy = groups.slice(0, i).map((g) => g.id);
  }
  return groups;
}

function writeStoryGraph(root) {
  const storiesPath = path.join(root, 'specs', 'stories', 'stories.json');
  const stories = readJson(storiesPath, null);
  if (!Array.isArray(stories) || !stories.length) {
    throw new Error('spec-render-write: specs/stories/stories.json is missing or empty');
  }
  const decisions = readJson(path.join(root, 'specs', 'decisions', 'spec-decisions.json'), {});
  const safeguards = readJson(path.join(root, 'specs', 'brd', 'brd-safeguards.json'), []);
  const groups = topoGroups(stories);
  const plan = planClusters({ stories });
  const clusterOf = new Map();
  for (const c of plan.clusters) c.stories.forEach((id) => clusterOf.set(id, c));

  const features = [];
  const acIndex = [];
  const traces = [];
  let f = 1;
  for (const story of stories) {
    const cluster = clusterOf.get(story.id);
    story.cluster = cluster ? cluster.id : 'C1';
    story.invest = story.invest || {};
    story.invest.independent = !!(cluster && cluster.independently_startable);
    const acs = storyAcs(story);
    if (!acs.length) {
      throw new Error(`spec-render-write: ${story.id} has no acceptance_criteria`);
    }
    acIndex.push(...acs.map((ac) => ({
      id: ac.id, story: story.id, traces: ac.traces, given: ac.given, when: ac.when, then: ac.then,
    })));
    traces.push({
      id: story.id,
      text: story.title,
      traces: asArray(story.traces),
      acs: acs.map((ac) => ac.id),
    });
    for (const ac of acs) {
      const heavy = heavyReason(`${ac.given} ${ac.when} ${ac.then}`);
      features.push({
        id: `F${String(f).padStart(3, '0')}`,
        category: categoryOf(ac),
        story: story.id,
        group: story.group,
        cluster: story.cluster,
        acceptance_criterion: ac.id,
        description: ac.then,
        steps: featureSteps(ac),
        verification: heavy ? 'characterization' : 'default',
        passes: false,
        last_evaluated: null,
        failure_reason: null,
        failure_layer: null,
      });
      f += 1;
    }
    const md = renderStoryMd(story, cluster, acs, safeguards);
    fs.writeFileSync(path.join(root, 'specs', 'stories', `${story.id}.md`), md);
  }

  writeJson(storiesPath, stories);
  writeJson(path.join(root, 'specs', 'stories', 'acceptance-criteria.json'), acIndex);
  writeJson(path.join(root, 'specs', 'stories', 'story-traces.json'), traces);
  writeJson(path.join(root, 'specs', 'stories', 'dependency-graph.json'), { groups });
  writeJson(path.join(root, 'specs', 'stories', 'story-clusters.json'), plan);
  writeJson(path.join(root, 'features.json'), features);
  fs.writeFileSync(path.join(root, 'specs', 'stories', 'epics.md'), renderEpics(stories, decisions));
  fs.writeFileSync(
    path.join(root, 'specs', 'stories', 'dependency-graph.md'),
    renderGraphMd(groups, stories, plan),
  );

  const edges = [];
  for (const s of stories) {
    for (const d of asArray(s.depends_on)) {
      const dep = typeof d === 'string' ? { story: d, kind: 'behavior' } : d;
      edges.push({
        from: s.id, to: dep.story, kind: dep.kind || 'behavior',
        artifact: dep.artifact || null, reason: dep.reason || null,
      });
    }
  }
  writeJson(path.join(root, 'specs', 'stories', 'dependency-edges.json'), edges);

  return {
    stories: stories.length,
    features: features.length,
    clusters: plan.cluster_count,
    warnings: plan.warnings,
  };
}

function main(argv) {
  const rootIdx = argv.indexOf('--root');
  const root = rootIdx >= 0 ? argv[rootIdx + 1] : process.cwd();
  try {
    const result = writeStoryGraph(root);
    process.stdout.write(
      `spec-render-write: ${result.stories} stories, ${result.features} features, `
      + `${result.clusters} cluster(s)\n`,
    );
    for (const w of result.warnings || []) process.stdout.write(`  warning: ${w}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { writeStoryGraph, parseGwt, heavyReason, categoryOf, topoGroups };
