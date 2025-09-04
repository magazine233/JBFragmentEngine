#!/usr/bin/env node
// tools/offline-analyze.js
// Offline analyzer: connects directly to local Typesense, fetches fragments/pages,
// aggregates page docs if needed, computes page similarity and link graph,
// and writes outputs to data/.

const fs = require('fs');
const path = require('path');
// Use native fetch to call Typesense HTTP API directly

// Load .env if present (minimal parser)
try {
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) {
        const k = m[1];
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
          v = v.slice(1, -1);
        }
        if (!(k in process.env)) process.env[k] = v;
      }
    }
  }
} catch {}

const TYPESENSE_HOST = process.env.TYPESENSE_HOST || 'localhost';
const TYPESENSE_PORT = parseInt(process.env.TYPESENSE_PORT || '8108', 10);
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY || 'xyz123abc';

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    siteA: 'servicesaustralia.gov.au',
    siteB: 'my.gov.au',
    metrics: ['combined'],
    threshold: 0.4,
    maxPairs: 50000,
    outDir: path.join(process.cwd(), 'data')
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--site-a') out.siteA = args[++i];
    else if (a === '--site-b') out.siteB = args[++i];
    else if (a === '--metrics') out.metrics = args[++i].split(',').map(s=>s.trim());
    else if (a === '--threshold') out.threshold = parseFloat(args[++i]);
    else if (a === '--max-pairs') out.maxPairs = parseInt(args[++i], 10);
    else if (a === '--out-dir') out.outDir = args[++i];
  }
  return out;
}

function baseUrl(url) { try { const u = new URL(url); u.hash=''; u.search=''; return u.toString(); } catch { return (url||'').split('#')[0]; } }
function safeHost(url) { try { return new URL(url).hostname; } catch { return ''; } }
function normalizeText(text) { return (text||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim(); }
function jaccard(a, b) { if (!a.size&&!b.size) return 1; let inter=0; for (const x of a) if (b.has(x)) inter++; const union=a.size+b.size-inter; return union? inter/union : 0; }
function cosine(a, b) { if (!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length||!a.length) return 0; let dot=0,na=0,nb=0; for(let i=0;i<a.length;i++){const x=a[i]||0,y=b[i]||0;dot+=x*y;na+=x*x;nb+=y*y;} return (!na||!nb)?0:dot/Math.sqrt(na*nb); }

function buildHashedEmbedding(text, dim=256) {
  const vec = new Array(dim).fill(0);
  const toks = normalizeText(text).split(' ').filter(Boolean);
  for (const t of toks) {
    let h = 2166136261;
    for (let i=0;i<t.length;i++){ h^=t.charCodeAt(i); h=(h*16777619)>>>0; }
    vec[h % dim] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s,x)=>s+x*x,0))||1;
  return vec.map(v=>v/norm);
}

async function fetchAll(typesense, collection, fields, limit=200000) {
  const perPage = 250; let page = 1; let out = [];
  while (out.length < limit) {
    let res;
    try {
      res = await typesense.search(collection, { q:'*', query_by: 'title', include_fields: fields.join(','), per_page: perPage, page });
    } catch (e) {
      if ((e.message||'').includes('HTTP 404')) {
        return [];
      }
      throw e;
    }
    const hits = (res && res.hits) || [];
    if (!hits.length) break;
    out = out.concat(hits.map(h => h.document));
    if (res.found <= page * perPage) break; page++;
  }
  return out.slice(0, limit);
}

async function listCollections() {
  const url = `http://${TYPESENSE_HOST}:${TYPESENSE_PORT}/collections`;
  const res = await fetch(url, { headers: { 'X-TYPESENSE-API-KEY': TYPESENSE_API_KEY } });
  if (!res.ok) throw new Error(`Typesense list collections HTTP ${res.status}`);
  return await res.json();
}

function aggregatePagesFromFragments(fragments) {
  const pages = new Map();
  for (const f of fragments) {
    const page = baseUrl(f.url || ''); if (!page) continue;
    if (!pages.has(page)) pages.set(page, {
      id: page, url: page, host: safeHost(page), title: undefined,
      fragment_ids: [], fragment_count: 0,
      life_events: new Set(), categories: new Set(), states: new Set(),
      provider: new Set(), governance: new Set(), stage: new Set(), stage_variant: new Set(),
      content_text: '', keywords: new Set(), out_links: new Set(), out_link_tokens: new Set(), _lvl0Counts: new Map()
    });
    const a = pages.get(page);
    a.fragment_ids.push(f.id);
    a.fragment_count++;
    ;(f.life_events||[]).forEach(x => a.life_events.add(x));
    ;(f.categories||[]).forEach(x => a.categories.add(x));
    ;(f.states||[]).forEach(x => a.states.add(x));
    if (f.provider) a.provider.add(f.provider);
    if (f.governance) a.governance.add(f.governance);
    if (f.stage) a.stage.add(f.stage);
    if (f.stage_variant) a.stage_variant.add(f.stage_variant);
    const lvl0 = f.hierarchy_lvl0 || f.title || '';
    if (lvl0) a._lvl0Counts.set(lvl0, (a._lvl0Counts.get(lvl0)||0)+1);
    if (a.content_text.length < 40000) a.content_text += (a.content_text?'\n':'') + (f.content_text||'').slice(0, 4000);
    (f.search_keywords||[]).forEach(k => a.keywords.add(k));
    const html = f.content_html || '';
    const hrefs = Array.from(html.matchAll(/href\s*=\s*"([^"]+)"/gi)).map(m => m[1]);
    for (const h of hrefs) {
      try {
        const u = new URL(h, page);
        if (!['http:', 'https:'].includes(u.protocol)) continue;
        const b = baseUrl(u.toString());
        a.out_links.add(b);
        const seg = (u.pathname || '/').split('/').filter(Boolean)[0] || '';
        const host = (u.hostname || '').toLowerCase();
        if (host) a.out_link_tokens.add(host);
        if (host && seg) a.out_link_tokens.add(`${host}/${seg.toLowerCase()}`);
      } catch {}
    }
  }
  const docs = [];
  for (const a of pages.values()) {
    if (a._lvl0Counts.size) a.title = Array.from(a._lvl0Counts.entries()).sort((x,y)=>y[1]-x[1])[0][0];
    docs.push({
      id: a.id, url: a.url, host: a.host, title: a.title,
      fragment_ids: a.fragment_ids, fragment_count: a.fragment_count,
      life_events: Array.from(a.life_events), categories: Array.from(a.categories), states: Array.from(a.states),
      provider: Array.from(a.provider), governance: Array.from(a.governance), stage: Array.from(a.stage), stage_variant: Array.from(a.stage_variant),
      content_text: a.content_text, keywords: Array.from(a.keywords),
      embedding: buildHashedEmbedding(a.content_text||'', 256),
      out_links: Array.from(a.out_links), out_link_tokens: Array.from(a.out_link_tokens)
    });
  }
  return docs;
}

function computeSimilarity(A, B, metric, threshold, maxPairs) {
  // Build indices for B
  const idxTag = new Map(); const idxKey = new Map(); const idxLink = new Map();
  for (let i=0;i<B.length;i++) {
    const b = B[i];
    const tags = new Set([...(b.life_events||[]), ...(b.categories||[])]);
    for (const t of tags) { const k=(t||'').toLowerCase(); if (!idxTag.has(k)) idxTag.set(k,new Set()); idxTag.get(k).add(i); }
    for (const k of (b.keywords||[])) { const kk=(k||'').toLowerCase(); if (!idxKey.has(kk)) idxKey.set(kk,new Set()); idxKey.get(kk).add(i); }
    for (const t of (b.out_link_tokens||[])) { const kk=(t||'').toLowerCase(); if (!idxLink.has(kk)) idxLink.set(kk,new Set()); idxLink.get(kk).add(i); }
  }
  const pairs = []; const seen = new Set();
  for (const a of A) {
    const cand = new Set();
    const aTags = new Set([...(a.life_events||[]), ...(a.categories||[])]);
    for (const t of aTags) { const s = idxTag.get((t||'').toLowerCase()); if (s) s.forEach(i=>cand.add(i)); }
    let addedK=0; for (const k of (a.keywords||[])) { if (addedK>=25) break; const s=idxKey.get((k||'').toLowerCase()); if (s){ s.forEach(i=>cand.add(i)); addedK++; } }
    let addedL=0; for (const t of (a.out_link_tokens||[])) { if (addedL>=25) break; const s=idxLink.get((t||'').toLowerCase()); if (s){ s.forEach(i=>cand.add(i)); addedL++; } }
    const aLinks = new Set(a.out_link_tokens||[]);
    for (const i of cand) {
      const b = B[i];
      const key = a.url+'|'+b.url; if (seen.has(key)) continue; seen.add(key);
      const bTags = new Set([...(b.life_events||[]), ...(b.categories||[])]);
      const tagSim = jaccard(aTags, bTags);
      const embSim = (Array.isArray(a.embedding)&&Array.isArray(b.embedding)) ? cosine(a.embedding,b.embedding) : 0;
      const linkSim = jaccard(aLinks, new Set(b.out_link_tokens||[]));
      let score;
      if (metric==='tags') score = tagSim;
      else if (metric==='embedding') score = embSim;
      else if (metric==='link') score = linkSim;
      else score = 0.5*tagSim + 0.3*embSim + 0.2*linkSim;
      if (score >= threshold) {
        pairs.push({ a, b, score, tagSim, embSim, linkSim });
      }
    }
  }
  pairs.sort((x,y)=> y.score - x.score);
  return pairs.slice(0, maxPairs);
}

function writeCSV(rows, dest) {
  const esc = v => '"' + String(v==null?'':v).replace(/"/g,'""') + '"';
  const headers = Object.keys(rows[0] || {});
  const lines = [ headers.map(esc).join(',') ];
  for (const r of rows) lines.push(headers.map(h => esc(r[h])).join(','));
  fs.writeFileSync(dest, lines.join('\n'));
}

async function main() {
  const opts = parseArgs();
  if (!fs.existsSync(opts.outDir)) fs.mkdirSync(opts.outDir, { recursive: true });
  console.log(`Typesense @ http://${TYPESENSE_HOST}:${TYPESENSE_PORT} (key tail: ${String(TYPESENSE_API_KEY).slice(-6)})`);

  const typesense = {
    async search(collection, params) {
      const url = `http://${TYPESENSE_HOST}:${TYPESENSE_PORT}/collections/${encodeURIComponent(collection)}/documents/search`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-TYPESENSE-API-KEY': TYPESENSE_API_KEY },
        body: JSON.stringify(params)
      });
      if (!res.ok) throw new Error(`Typesense ${collection} search HTTP ${res.status}`);
      return await res.json();
    }
  };
  // Try to fetch pages; if empty, aggregate from fragments
  let pages = [];
  try {
    const cols = await listCollections();
    const names = (cols || []).map(c => c.name);
    console.log('Typesense collections:', names.join(', ') || '(none)');
  } catch (e) {
    console.warn('Could not list Typesense collections:', e.message);
  }
  try {
    pages = await fetchAll(typesense, 'content_pages', ['url','host','title','life_events','categories','states','keywords','embedding','out_links','out_link_tokens','fragment_count'], 200000);
  } catch (e) {
    // ignore
  }
  if (!pages || pages.length === 0) {
    let frags = [];
    try {
      frags = await fetchAll(typesense, 'content_fragments', ['id','url','title','content_text','content_html','life_events','categories','states','provider','governance','stage','stage_variant','hierarchy_lvl0','search_keywords'], 200000);
    } catch (e) {
      console.warn('Error fetching content_fragments:', e.message);
    }
    if (!frags || frags.length === 0) {
      console.error('No content_pages or content_fragments found in Typesense. Ensure the scraper has indexed data and you are pointing to the right instance.');
      process.exit(2);
    }
    pages = aggregatePagesFromFragments(frags);
  }

  // Partition by host
  const A = []; const B = [];
  for (const d of pages) {
    const host = (d.host || safeHost(d.url) || '').toLowerCase();
    if (host.endsWith(opts.siteA)) A.push(d); else if (host.endsWith(opts.siteB)) B.push(d);
  }
  console.log(`Pages in scope: A=${A.length} (${opts.siteA}), B=${B.length} (${opts.siteB})`);

  for (const metric of opts.metrics) {
    const pairs = computeSimilarity(A, B, metric, opts.threshold, opts.maxPairs);
    const rows = pairs.map(p => ({
      a_url: p.a.url, b_url: p.b.url,
      a_title: p.a.title||'', b_title: p.b.title||'',
      a_fragments: p.a.fragment_count||0, b_fragments: p.b.fragment_count||0,
      score: p.score.toFixed(3), tag_sim: p.tagSim.toFixed(3), emb_sim: p.embSim.toFixed(3), link_sim: p.linkSim.toFixed(3)
    }));
    const outPath = path.join(opts.outDir, `pages_similarity_${metric}.csv`);
    writeCSV(rows, outPath);
    console.log(`Wrote ${rows.length} rows → ${outPath}`);
  }

  // Link graph
  const nodeByUrl = new Map(pages.map(p => [p.url, p]));
  const edges = [];
  for (const p of pages) {
    const links = Array.from(new Set(p.out_links || [])).slice(0, 1000);
    for (const L of links) {
      if (!nodeByUrl.has(L)) continue; // only keep edges to known pages
      const aHost = (p.host || safeHost(p.url) || '').toLowerCase();
      const bHost = (nodeByUrl.get(L).host || safeHost(L) || '').toLowerCase();
      // Keep all edges; consumers can filter cross-site later
      edges.push({ source: p.url, target: L });
      if (edges.length >= 200000) break;
    }
    if (edges.length >= 200000) break;
  }
  const graph = {
    nodes: pages.map(d => ({ id: d.url, url: d.url, title: d.title || d.url, host: d.host })),
    edges
  };
  const graphPath = path.join(opts.outDir, 'link_graph.json');
  fs.writeFileSync(graphPath, JSON.stringify(graph));
  console.log(`Wrote link graph with ${graph.nodes.length} nodes, ${graph.edges.length} edges → ${graphPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
