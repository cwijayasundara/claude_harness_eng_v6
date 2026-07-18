import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const MARKDOWN_LINK = /\]\(([^)\s]+\.md)(?:#[A-Za-z0-9_-]*)?\)/g;
const INLINE_CODE = /`([^`\n]+)`/g;

async function exists(target) {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(target));
    else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md") files.push(target);
  }
  return files.sort();
}

function parseDocument(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const frontmatter = {};
  if (match) {
    for (const line of match[1].split("\n")) {
      const field = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
      if (!field) continue;
      const [, key, raw] = field;
      if (key === "tags") {
        frontmatter.tags = raw.replace(/^\[/, "").replace(/\]$/, "")
          .split(",").map((tag) => tag.trim()).filter(Boolean);
      } else {
        frontmatter[key] = raw.replace(/^"|"$/g, "");
      }
    }
  }
  return { frontmatter, body: text.slice(match?.[0].length ?? 0) };
}

function resolveWikiLink(target, documentId) {
  if (target.includes("://") || target.startsWith("/")) return null;
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(documentId), target));
  return resolved.replace(/\.md$/, "");
}

async function resolveSourcePath(candidate, repositoryRoot) {
  if (!candidate || candidate.includes("\n") || candidate.startsWith("/") || candidate.includes("://")) return null;
  const normalized = candidate.replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("../")) return null;
  const absolute = path.resolve(repositoryRoot, normalized);
  if (!absolute.startsWith(`${path.resolve(repositoryRoot)}${path.sep}`)) return null;
  if (!(await exists(absolute))) return null;
  const info = await stat(absolute);
  return info.isDirectory() ? `${normalized}/` : normalized;
}

async function sourceReferences({ body, frontmatter, repositoryRoot }) {
  const candidates = new Set();
  if (frontmatter.resource) candidates.add(frontmatter.resource);
  for (const match of body.matchAll(INLINE_CODE)) candidates.add(match[1]);
  const references = new Set();
  for (const candidate of candidates) {
    const source = await resolveSourcePath(candidate, repositoryRoot);
    if (source) references.add(source);
  }
  return [...references].sort();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;",
  }[character]));
}

function htmlDocument(graph) {
  const graphJson = JSON.stringify(graph).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(graph.name)} context graph</title>
<script src="https://cdn.jsdelivr.net/npm/cytoscape@3.33.1/dist/cytoscape.min.js"></script>
<style>
:root { color-scheme: dark; --panel:#121925; --line:#2c3c52; --text:#e6edf7; --muted:#a9b7ca; --accent:#71b7ff; }
* { box-sizing:border-box } body { margin:0; font:14px/1.45 ui-sans-serif,system-ui,sans-serif; background:#0b1018; color:var(--text); }
header { padding:16px 20px; border-bottom:1px solid var(--line); background:var(--panel); } h1 { font-size:18px; margin:0 0 4px } #summary { color:var(--muted) }
main { display:grid; grid-template-columns:300px minmax(0,1fr) 340px; height:calc(100vh - 77px); } aside { background:var(--panel); padding:16px; overflow:auto; } #controls { border-right:1px solid var(--line) } #detail { border-left:1px solid var(--line) }
label { display:block; color:var(--muted); font-size:12px; margin:14px 0 5px } input,select,button { width:100%; border:1px solid var(--line); border-radius:6px; background:#0b1018; color:var(--text); padding:8px; } button { cursor:pointer; margin-top:12px; } #graph { min-width:0; min-height:0; }
.legend { margin-top:18px; display:grid; gap:7px; color:var(--muted) }.dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:7px }.wiki { background:#6ea8fe }.source { background:#f6bd60 }.tag { background:#8bd3a8 }
#detail h2 { margin:0 0 6px; font-size:17px; overflow-wrap:anywhere } #detail p { color:var(--muted) } #detail ul { padding-left:18px } #detail code { color:#b7d7ff; overflow-wrap:anywhere }
@media (max-width:900px) { main { grid-template-columns:220px minmax(0,1fr); } #detail { display:none } } @media (max-width:600px) { main { grid-template-columns:1fr; } #controls { display:none } }
</style></head><body>
<header><h1>${escapeHtml(graph.name)} — context graph</h1><div id="summary"></div></header>
<main><aside id="controls"><label for="search">Search titles, paths, tags</label><input id="search" type="search" placeholder="e.g. telemetry">
<label for="kind">Node kind</label><select id="kind"><option value="all">All nodes</option><option value="wiki">Wiki pages</option><option value="source">Repository sources</option></select>
<label for="tag">Tag</label><select id="tag"><option value="all">All tags</option></select><label for="layout">Layout</label><select id="layout"><option value="cose">Force-directed</option><option value="concentric">Concentric</option><option value="breadthfirst">Breadth-first</option><option value="grid">Grid</option></select><button id="fit">Fit graph</button>
<div class="legend"><span><i class="dot wiki"></i>Wiki page</span><span><i class="dot source"></i>Repository source</span><span><i class="dot tag"></i>Tag match highlight</span></div></aside><div id="graph"></div><aside id="detail"><p>Select a node to inspect its context.</p></aside></main>
<script>
const data = ${graphJson};
const graph = document.getElementById('graph'), detail = document.getElementById('detail');
document.getElementById('summary').textContent = data.stats.documents + ' wiki pages · ' + data.stats.sources + ' repository sources · ' + data.stats.relationships + ' relationships';
const tagSelect = document.getElementById('tag'); data.tags.forEach(tag => tagSelect.add(new Option(tag, tag)));
const cy = cytoscape({ container: graph, elements: data.elements, style: [
  { selector:'node', style:{ 'label':'data(label)', 'background-color':'data(color)', 'width':'data(size)', 'height':'data(size)', 'font-size':10, 'color':'#e6edf7', 'text-outline-color':'#0b1018', 'text-outline-width':2, 'text-wrap':'wrap', 'text-max-width':110 } },
  { selector:'edge', style:{ 'curve-style':'bezier', 'line-color':'#52667f', 'target-arrow-color':'#52667f', 'target-arrow-shape':'triangle', 'width':1.5, 'opacity':0.7 } },
  { selector:'.hidden', style:{ display:'none' } }, { selector:'.matched', style:{ 'border-width':4, 'border-color':'#8bd3a8' } }, { selector:':selected', style:{ 'border-width':4, 'border-color':'#fff' } }
]});
function layout() { cy.layout({ name:document.getElementById('layout').value, animate:true, padding:35, ...(document.getElementById('layout').value === 'cose' ? { idealEdgeLength:110, nodeRepulsion:8000 } : {}) }).run(); }
function applyFilters() { const search=document.getElementById('search').value.toLowerCase(), kind=document.getElementById('kind').value, tag=tagSelect.value; cy.nodes().forEach(n => { const d=n.data(), searchable=[d.label,d.path,d.description,...d.tags].join(' ').toLowerCase(); const show=(kind==='all'||d.kind===kind)&&(!search||searchable.includes(search))&& (tag==='all'||d.tags.includes(tag)); n.toggleClass('hidden',!show); n.toggleClass('matched',tag!=='all'&&d.tags.includes(tag)); }); cy.edges().forEach(e => e.toggleClass('hidden', e.source().hasClass('hidden') || e.target().hasClass('hidden'))); }
function showDetail(node) { const d=node.data(), backlinks=cy.edges('[target = "'+d.id.replace(/"/g,'\\"')+'"]').map(e=>e.source().data('label')); detail.innerHTML='<h2>'+escape(d.label)+'</h2><p><strong>'+escape(d.kind==='wiki' ? d.type : 'Repository source')+'</strong></p><p>'+escape(d.description||'No summary available.')+'</p><p><code>'+escape(d.path)+'</code></p>'+(d.tags.length?'<p>Tags: '+d.tags.map(escape).join(', ')+'</p>':'')+'<p>Referenced by: '+(backlinks.length?backlinks.map(escape).join(', '):'none')+'</p>'; }
function escape(value) { const div=document.createElement('div'); div.textContent=value; return div.innerHTML; }
cy.on('tap','node', event => showDetail(event.target)); ['search','kind','tag'].forEach(id=>document.getElementById(id).addEventListener('input',applyFilters)); document.getElementById('layout').addEventListener('change',layout); document.getElementById('fit').addEventListener('click',()=>cy.fit(undefined,35)); layout();
</script></body></html>`;
}

export async function generateContextGraph({ bundleRoot, repositoryRoot, outPath, name }) {
  const root = path.resolve(bundleRoot);
  const repository = path.resolve(repositoryRoot);
  const documents = [];
  const sourceNodes = new Map();
  const files = await markdownFiles(root);
  const documentIds = new Set(files.map((file) => path.relative(root, file).replace(/\.md$/, "").split(path.sep).join("/")));

  for (const file of files) {
    const id = path.relative(root, file).replace(/\.md$/, "").split(path.sep).join("/");
    const { frontmatter, body } = parseDocument(await readFile(file, "utf8"));
    const links = [...body.matchAll(MARKDOWN_LINK)].map((match) => resolveWikiLink(match[1], id)).filter((target) => target && documentIds.has(target));
    const sources = await sourceReferences({ body, frontmatter, repositoryRoot: repository });
    documents.push({ id, kind: "wiki", type: frontmatter.type || "Wiki page", label: frontmatter.title || id, description: frontmatter.description || "", path: `${id}.md`, tags: frontmatter.tags || [], links: [...new Set(links)], sources });
    for (const source of sources) sourceNodes.set(source, { id: `source:${source}`, kind: "source", type: "Repository source", label: source, description: "Source referenced by the generated wiki.", path: source, tags: [] });
  }

  const nodes = [...documents, ...sourceNodes.values()];
  const edges = [];
  for (const document of documents) {
    for (const target of document.links) edges.push({ source: document.id, target, relationship: "links to" });
    for (const source of document.sources) edges.push({ source: document.id, target: `source:${source}`, relationship: "references" });
  }
  const colors = { wiki: "#6ea8fe", source: "#f6bd60" };
  const elements = [
    ...nodes.map((node) => ({ data: { ...node, color: colors[node.kind], size: node.kind === "wiki" ? 42 : 28 } })),
    ...edges.map((edge, index) => ({ data: { id: `edge-${index}`, ...edge } })),
  ];
  const graph = { name: name || path.basename(root), generatedAt: new Date().toISOString(), tags: [...new Set(documents.flatMap((document) => document.tags))].sort(), stats: { documents: documents.length, sources: sourceNodes.size, relationships: edges.length }, elements };
  const output = path.resolve(outPath || path.join(root, "context-graph.html"));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, htmlDocument(graph), "utf8");
  return { ...graph.stats, outPath: output };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  if (!args.includes("--bundle")) throw new Error("Usage: node scripts/generate-context-graph.mjs --bundle <wiki-dir> [--repo <repository-root>] [--out <html-file>] [--name <display-name>]");
  const bundleRoot = value("--bundle");
  const repositoryRoot = value("--repo") || path.resolve(bundleRoot, "../..");
  const result = await generateContextGraph({ bundleRoot, repositoryRoot, outPath: value("--out"), name: value("--name") });
  console.log(`Wrote ${result.documents} wiki pages, ${result.sources} repository sources, and ${result.relationships} relationships → ${result.outPath}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
}
