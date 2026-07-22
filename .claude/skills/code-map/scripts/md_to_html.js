#!/usr/bin/env node
'use strict';

// Minimal, dependency-free Markdown -> HTML renderer, scoped to what the
// deterministic code_wiki output uses: headings, paragraphs, ordered/unordered
// lists, tables, fenced + inline code, blockquotes, bold/italic, links, and
// horizontal rules. Not a full CommonMark implementation — it renders the wiki,
// nothing more. All text is HTML-escaped before inline markup is applied, so
// graph-derived content cannot inject markup.

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Defense-in-depth: allowlist safe URL kinds only (relative paths, fragments,
// http(s)/mailto). Entities are decoded first so an encoded scheme
// (e.g. &#106;avascript: or &amp;#106;…) cannot slip past a prefix check.
// Anything with a non-allowlisted scheme becomes "#". Wiki content is
// deterministically generated, but this renderer must be safe on any markdown.
function decodeEntities(u) {
  return String(u)
    .replace(/&amp;/gi, '&')
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d) => String.fromCharCode(parseInt(d, 10)));
}
function safeHref(u) {
  const d = decodeEntities(u).trim();
  if (/^(#|\/|\.{0,2}\/)/.test(d)) return u;       // fragment or relative path
  const m = d.match(/^([a-z][a-z0-9+.-]*):/i);      // explicit scheme?
  if (m && !/^(https?|mailto)$/i.test(m[1])) return '#';
  return u;
}

function renderInline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => `<a href="${safeHref(u)}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

const isHeading = (l) => /^#{1,6}\s+/.test(l);
const isFence = (l) => /^```/.test(l);
const isQuote = (l) => /^\s*>\s?/.test(l);
const isHr = (l) => /^\s*(---|\*\*\*|___)\s*$/.test(l);
const isListItem = (l) => /^\s*([-*+]|\d+\.)\s+/.test(l);
const isTableRow = (l) => /^\s*\|.*\|\s*$/.test(l);
const isTableSep = (l) => !!l && /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-');
const splitRow = (l) => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());

function renderHeading(line) {
  const m = line.match(/^(#{1,6})\s+(.*)$/);
  const lvl = m[1].length;
  return `<h${lvl}>${renderInline(m[2].trim())}</h${lvl}>`;
}

function takeFence(lines, i) {
  const body = [];
  let j = i + 1;
  while (j < lines.length && !isFence(lines[j])) body.push(lines[j++]);
  return { html: `<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`, next: j + 1 };
}

function takeQuote(lines, i) {
  const body = [];
  let j = i;
  while (j < lines.length && isQuote(lines[j])) body.push(lines[j++].replace(/^\s*>\s?/, ''));
  return { html: `<blockquote>${renderInline(body.join(' '))}</blockquote>`, next: j };
}

function takeTable(lines, i) {
  const head = splitRow(lines[i]);
  let j = i + 2;
  const rows = [];
  while (j < lines.length && isTableRow(lines[j])) rows.push(splitRow(lines[j++]));
  const th = head.map((c) => `<th>${renderInline(c)}</th>`).join('');
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join('')}</tr>`).join('');
  return { html: `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`, next: j };
}

function takeList(lines, i) {
  const ordered = /^\s*\d+\.\s/.test(lines[i]);
  const items = [];
  let j = i;
  while (j < lines.length && isListItem(lines[j])) items.push(lines[j++].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
  const tag = ordered ? 'ol' : 'ul';
  return { html: `<${tag}>${items.map((t) => `<li>${renderInline(t)}</li>`).join('')}</${tag}>`, next: j };
}

function takeParagraph(lines, i) {
  const body = [];
  let j = i;
  while (j < lines.length && lines[j].trim() !== '' && !isBlockStart(lines, j)) body.push(lines[j++]);
  return { html: `<p>${renderInline(body.join(' '))}</p>`, next: j };
}

function isBlockStart(lines, i) {
  const l = lines[i];
  return isHeading(l) || isFence(l) || isQuote(l) || isHr(l) || isListItem(l) ||
    (isTableRow(l) && isTableSep(lines[i + 1]));
}

function mdToHtml(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim() === '') { i++; continue; }
    if (isHeading(l)) { out.push(renderHeading(l)); i++; continue; }
    if (isHr(l)) { out.push('<hr>'); i++; continue; }
    let block = null;
    if (isFence(l)) block = takeFence(lines, i);
    else if (isQuote(l)) block = takeQuote(lines, i);
    else if (isTableRow(l) && isTableSep(lines[i + 1])) block = takeTable(lines, i);
    else if (isListItem(l)) block = takeList(lines, i);
    else block = takeParagraph(lines, i);
    out.push(block.html);
    i = block.next;
  }
  return out.join('\n');
}

module.exports = { mdToHtml, renderInline, escapeHtml };
