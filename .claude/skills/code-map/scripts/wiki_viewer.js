#!/usr/bin/env node
'use strict';

// Render the committed DeepWiki (specs/brownfield/wiki/*.md) into a single
// self-contained, dependency-free HTML "wiki browser": a grouped, searchable
// page index, rendered page content, in-app link navigation, and a backlinks
// panel. Sibling to graph_viewer.js — presentation + browser logic live in
// wiki-viewer-template.html; this file builds the page model and binds it in.
//
// Usage: node wiki_viewer.js [--wiki specs/brownfield/wiki] [--out graph...html] [--repo label]

const fs = require('fs');
const path = require('path');
const { mdToHtml } = require('./md_to_html');

const TEMPLATE = path.join(__dirname, 'wiki-viewer-template.html');
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function parseArgs(argv) {
  const args = { wiki: 'specs/brownfield/wiki', out: 'specs/brownfield/wiki-browser.html', repo: path.basename(process.cwd()) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--wiki') args.wiki = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
  }
  return args;
}

function titleOf(rel, md) {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : rel.replace(/\.md$/, '');
}

function groupOf(rel) {
  if (rel === 'WIKI.md') return 'overview';
  if (rel.startsWith('pages/')) return 'pages';
  if (rel.startsWith('concepts/')) return 'concepts';
  return 'other';
}

function plainText(md) {
  return md.replace(/[#>*`|_-]+/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

// Resolve a markdown href (relative to the linking file's dir) to a wiki page
// id, or null when it points outside the wiki (source refs, external URLs).
function resolveHref(href, fromDir, idSet) {
  if (/^[a-z]+:/i.test(href) || href.startsWith('#')) return null;
  const clean = href.split('#')[0].split('?')[0];
  if (!clean) return null;
  const id = path.posix.normalize(path.posix.join(fromDir, clean)).replace(/^\.\//, '');
  return idSet.has(id) ? id : null;
}

function rewriteLinks(html, fromDir, idSet) {
  const links = new Set();
  const out = html.replace(/<a href="([^"]+)">/g, (m, href) => {
    const id = resolveHref(href, fromDir, idSet);
    if (!id) return m;
    links.add(id);
    return `<a href="#/${escapeHtml(id)}" data-nav="${escapeHtml(id)}" class="wl">`;
  });
  return { html: out, links: [...links].sort() };
}

function computeBacklinks(pages) {
  const back = new Map(pages.map((p) => [p.id, []]));
  for (const p of pages) for (const t of p.links) if (back.has(t)) back.get(t).push(p.id);
  for (const p of pages) p.backlinks = back.get(p.id).sort();
}

function buildWikiModel(files, repo) {
  const sorted = files.slice().sort((a, b) => a.rel.localeCompare(b.rel));
  const idSet = new Set(sorted.map((f) => f.rel));
  const pages = sorted.map((f) => {
    const fromDir = path.posix.dirname(f.rel);
    const rendered = rewriteLinks(mdToHtml(f.md), fromDir === '.' ? '' : fromDir, idSet);
    return {
      id: f.rel, title: titleOf(f.rel, f.md), group: groupOf(f.rel),
      html: rendered.html, links: rendered.links, text: plainText(f.md),
    };
  });
  computeBacklinks(pages);
  const groups = {};
  for (const p of pages) groups[p.group] = (groups[p.group] || 0) + 1;
  return { repo, home: idSet.has('WIKI.md') ? 'WIKI.md' : (pages[0] && pages[0].id), stats: { pages: pages.length, groups }, pages };
}

function readWiki(wikiDir) {
  const files = [];
  const walk = (dir, base) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = base ? `${base}/${name}` : name;
      if (fs.statSync(full).isDirectory()) walk(full, rel);
      else if (name.endsWith('.md')) files.push({ rel, md: fs.readFileSync(full, 'utf8') });
    }
  };
  walk(wikiDir, '');
  return files;
}

function render(model, template) {
  const data = JSON.stringify(model).replace(/</g, '\\u003c');
  const title = escapeHtml(`wiki browser — ${model.repo}`);
  return template.replace('__TITLE__', () => title).replace('__WIKI_DATA__', () => data);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = readWiki(args.wiki);
  if (!files.length) { process.stderr.write(`wiki_viewer: no .md files under ${args.wiki}\n`); process.exit(1); }
  const model = buildWikiModel(files, args.repo);
  const html = render(model, fs.readFileSync(TEMPLATE, 'utf8'));
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, html);
  process.stderr.write(`Wrote ${args.out} — ${model.stats.pages} pages (${(html.length / 1024).toFixed(0)} KB)\n`);
}

if (require.main === module) main();
module.exports = { buildWikiModel, render, resolveHref };
