// api/routes/pages.js
const express = require('express');
const router = express.Router();

// Utility functions
function baseUrl(url) {
  try { const u = new URL(url); u.hash = ''; u.search = ''; return u.toString(); } catch { return (url||'').split('#')[0]; }
}
function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 1;
  let inter = 0; for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { const x=a[i]||0, y=b[i]||0; dot+=x*y; na+=x*x; nb+=y*y; }
  if (!na || !nb) return 0; return dot / Math.sqrt(na * nb);
}

// Search pages (simple wrapper around Typesense)
router.get('/search', async (req, res) => {
  try {
    const typesense = req.app.locals.typesense;
    const q = req.query.q || '*';
    const page = parseInt(req.query.page || '1', 10);
    const per_page = Math.min(parseInt(req.query.per_page || '20', 10), 250);
    const filters = [];
    if (req.query.host) filters.push(`host:=${escapeFilter(req.query.host)}`);
    if (req.query.life_event) filters.push(`life_events:=[${escapeArray(req.query.life_event)}]`);
    if (req.query.category) filters.push(`categories:=[${escapeArray(req.query.category)}]`);
    const filter_by = filters.join(' && ');
    const include_fields = 'url,host,title,life_events,categories,fragment_count';
    const results = await typesense
      .collections('content_pages')
      .documents()
      .search({ q, query_by: 'title,content_text,keywords', filter_by, include_fields, per_page, page });
    res.json({ page: results.page, found: results.found, results: results.hits || [] });
  } catch (e) {
    console.error('pages/search error:', e);
    res.status(500).json({ error: 'pages search failed', message: e.message });
  }
});

// Compute page-level similarity across two sites (tags | embedding | combined)
router.get('/similarity', async (req, res) => {
  try {
    const typesense = req.app.locals.typesense;
    const siteA = req.query.site_a || 'servicesaustralia.gov.au';
    const siteB = req.query.site_b || 'my.gov.au';
    const metric = (req.query.metric || 'tags').toLowerCase(); // tags|embedding|link|combined
    const simThreshold = Math.min(Math.max(parseFloat(req.query.threshold || '0.4'), 0), 1);
    const maxPairs = Math.min(parseInt(req.query.max_pairs || '5000', 10), 50000);
    const format = (req.query.format || 'json').toLowerCase();

    // fetch all pages (paged)
    const fields = ['url','host','title','life_events','categories','keywords','embedding','out_link_tokens','fragment_count'];
    const pages = await fetchAll(typesense, 'content_pages', fields);
    const A = []; const B = [];
    for (const d of pages) {
      const host = d.host || (safeHost(d.url));
      if (host.endsWith(siteA)) A.push(d); else if (host.endsWith(siteB)) B.push(d);
    }

    // Build candidate index on B
    const bTagIndex = new Map(); // token -> Set(idx)
    const bKeyIndex = new Map(); // keyword -> Set(idx)
    const bLinkIndex = new Map(); // out_link_token -> Set(idx)
    for (let i = 0; i < B.length; i++) {
      const d = B[i];
      const tags = new Set([...(d.life_events||[]), ...(d.categories||[])]);
      for (const t of tags) { const k = t.toLowerCase(); if (!bTagIndex.has(k)) bTagIndex.set(k, new Set()); bTagIndex.get(k).add(i); }
      for (const k of (d.keywords||[])) { const kk = k.toLowerCase(); if (!bKeyIndex.has(kk)) bKeyIndex.set(kk, new Set()); bKeyIndex.get(kk).add(i); }
      for (const t of (d.out_link_tokens || [])) { const kk = t.toLowerCase(); if (!bLinkIndex.has(kk)) bLinkIndex.set(kk, new Set()); bLinkIndex.get(kk).add(i); }
    }

    const pairs = [];
    const seen = new Set();
    for (const a of A) {
      const cand = new Set();
      const aTags = new Set([...(a.life_events||[]), ...(a.categories||[])]);
      // tag candidates
      for (const t of aTags) {
        const s = bTagIndex.get((t||'').toLowerCase()); if (s) s.forEach(i => cand.add(i));
      }
      // keyword candidates (limit fanout)
      let added = 0;
      for (const k of (a.keywords||[])) {
        if (added >= 25) break;
        const s = bKeyIndex.get((k||'').toLowerCase()); if (s) { s.forEach(i => cand.add(i)); added++; }
      }
      // link token candidates (limited)
      let addedL = 0;
      for (const t of (a.out_link_tokens||[])) {
        if (addedL >= 25) break;
        const s = bLinkIndex.get((t||'').toLowerCase()); if (s) { s.forEach(i => cand.add(i)); addedL++; }
      }
      for (const i of cand) {
        const b = B[i];
        const key = a.url + '|' + b.url; if (seen.has(key)) continue; seen.add(key);
        const bTags = new Set([...(b.life_events||[]), ...(b.categories||[])]);
        const tagSim = jaccard(aTags, bTags);
        let embSim = 0;
        let linkSim = 0;
        if (Array.isArray(a.embedding) && Array.isArray(b.embedding)) embSim = cosine(a.embedding, b.embedding);
        const aLinks = new Set(a.out_link_tokens || []);
        const bLinks = new Set(b.out_link_tokens || []);
        linkSim = jaccard(aLinks, bLinks);
        let score;
        if (metric === 'tags') score = tagSim;
        else if (metric === 'embedding') score = embSim;
        else if (metric === 'link') score = linkSim;
        else score = 0.5 * tagSim + 0.3 * embSim + 0.2 * linkSim;
        if (score >= simThreshold) {
          pairs.push({
            a: { url: a.url, title: a.title, life_events: a.life_events, categories: a.categories, fragment_count: a.fragment_count },
            b: { url: b.url, title: b.title, life_events: b.life_events, categories: b.categories, fragment_count: b.fragment_count },
            score: +score.toFixed(3), tag_sim: +tagSim.toFixed(3), emb_sim: +embSim.toFixed(3), link_sim: +linkSim.toFixed(3)
          });
        }
      }
    }

    pairs.sort((x,y)=> y.score - x.score);
    const top = pairs.slice(0, maxPairs);

    if (format === 'csv') {
      const Papa = require('papaparse');
      const rows = top.map(p => ({
        a_url: p.a.url, b_url: p.b.url,
        a_title: p.a.title, b_title: p.b.title,
        a_fragments: p.a.fragment_count || 0, b_fragments: p.b.fragment_count || 0,
        score: p.score, tag_sim: p.tag_sim, emb_sim: p.emb_sim, link_sim: p.link_sim,
        overlap_life_events: (p.a.life_events||[]).filter(x => new Set(p.b.life_events||[]).has(x)).join('|'),
        overlap_categories: (p.a.categories||[]).filter(x => new Set(p.b.categories||[]).has(x)).join('|')
      }));
      const csv = Papa.unparse(rows, { header: true, skipEmptyLines: true });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="pages_similarity_export.csv"');
      return res.send(csv);
    }

    res.json({
      params: { site_a: siteA, site_b: siteB, metric, threshold: simThreshold, max_pairs: maxPairs },
      counts: { site_a_pages: A.length, site_b_pages: B.length, returned_pairs: top.length },
      pairs: top
    });
  } catch (e) {
    console.error('pages/similarity error:', e);
    res.status(500).json({ error: 'pages similarity failed', message: e.message });
  }
});

// Link graph between pages (content-only links)
router.get('/graph', async (req, res) => {
  try {
    const typesense = req.app.locals.typesense;
    const siteA = req.query.site_a || '';
    const siteB = req.query.site_b || '';
    const crossOnly = String(req.query.cross_only || 'false') === 'true';
    const maxEdges = Math.min(parseInt(req.query.max_edges || '5000', 10), 50000);
    const maxNodes = Math.min(parseInt(req.query.max_nodes || '2000', 10), 20000);

    const fields = ['url','host','title','out_links'];
    const pages = await fetchAll(typesense, 'content_pages', fields, 100000);
    const inScope = (d) => {
      if (!siteA && !siteB) return true;
      const h = d.host || safeHost(d.url);
      return (siteA && h.endsWith(siteA)) || (siteB && h.endsWith(siteB));
    };
    const nodes = pages.filter(inScope);
    const urlToNode = new Map(nodes.map(d => [d.url, d]));

    const edges = [];
    for (const a of nodes) {
      const srcHost = a.host || safeHost(a.url);
      const links = Array.from(new Set(a.out_links || [])).slice(0, 1000);
      for (const L of links) {
        const b = urlToNode.get(L);
        if (!b) continue;
        const tgtHost = b.host || safeHost(b.url);
        if (crossOnly) {
          if (siteA && siteB) {
            const aInA = srcHost.endsWith(siteA); const bInB = tgtHost.endsWith(siteB);
            const aInB = srcHost.endsWith(siteB); const bInA = tgtHost.endsWith(siteA);
            if (!(aInA && bInB) && !(aInB && bInA)) continue;
          } else if (siteA) {
            if (srcHost.endsWith(siteA) === tgtHost.endsWith(siteA)) continue;
          } else if (siteB) {
            if (srcHost.endsWith(siteB) === tgtHost.endsWith(siteB)) continue;
          }
        }
        edges.push({ source: a.url, target: b.url, score: 1 });
        if (edges.length >= maxEdges) break;
      }
      if (edges.length >= maxEdges) break;
    }

    // Limit nodes to those appearing in edges when limits requested
    const edgeUrls = new Set(); edges.forEach(e => { edgeUrls.add(e.source); edgeUrls.add(e.target); });
    let outNodes = nodes.filter(n => edgeUrls.has(n.url));
    if (outNodes.length > maxNodes) {
      outNodes = outNodes.slice(0, maxNodes);
    }
    const asNode = (d) => ({ id: d.url, url: d.url, title: d.title || d.url, host: d.host });

    res.json({ nodes: outNodes.map(asNode), edges });
  } catch (e) {
    console.error('pages/graph error:', e);
    res.status(500).json({ error: 'pages graph failed', message: e.message });
  }
});

async function fetchAll(typesense, collection, fields, limit = 40000) {
  const perPage = 250; let page = 1; let out = [];
  while (out.length < limit) {
    const res = await typesense
      .collections(collection)
      .documents()
      .search({ q: '*', query_by: 'title', include_fields: fields.join(','), per_page: perPage, page });
    if (!res.hits || res.hits.length === 0) break;
    out = out.concat(res.hits.map(h => h.document));
    if (res.found <= page * perPage) break; page++;
  }
  return out.slice(0, limit);
}

function safeHost(url) { try { return new URL(url).hostname; } catch { return ''; } }
function escapeFilter(v) { return String(v).replace(/([\"\\])/g, '\\$1'); }
function escapeArray(v) { return String(v).split(',').map(s => '"' + escapeFilter(s.trim()) + '"').join(','); }

module.exports = router;

// -------------------- Rebuild Pages Index from Fragments --------------------
// POST /api/pages/rebuild?site_a=&site_b=&limit=&prune=
// Aggregates existing content_fragments into content_pages.
router.post('/rebuild', async (req, res) => {
  try {
    const typesense = req.app.locals.typesense;
    const siteA = (req.query.site_a || '').trim();
    const siteB = (req.query.site_b || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '100000', 10), 200000);
    const prune = String(req.query.prune || 'true') === 'true';
    const CRAWL_VERSION = Math.floor(Date.now() / 1000);

    // Fetch fragments in pages
    const includeFields = [
      'id','url','title','content_text','content_html','life_events','categories','states','provider','governance','stage','stage_variant','hierarchy_lvl0','search_keywords'
    ];
    const frags = await fetchAll(typesense, 'content_fragments', includeFields, limit);

    // Filter by sites if provided
    const inScope = (d) => {
      if (!siteA && !siteB) return true;
      const h = safeHost(d.url);
      return (siteA && h.endsWith(siteA)) || (siteB && h.endsWith(siteB));
    };
    const scoped = frags.filter(inScope);

    // Aggregate by base page URL
    const accMap = new Map();
    for (const f of scoped) {
      const page = baseUrl(f.url || ''); if (!page) continue;
      if (!accMap.has(page)) {
        accMap.set(page, {
          id: page,
          url: page,
          host: safeHost(page),
          title: undefined,
          fragment_ids: [],
          fragment_count: 0,
          life_events: new Set(),
          categories: new Set(),
          states: new Set(),
          provider: new Set(),
          governance: new Set(),
          stage: new Set(),
          stage_variant: new Set(),
          content_text: '',
          keywords: new Set(),
          out_links: new Set(),
          out_link_tokens: new Set(),
          _lvl0Counts: new Map()
        });
      }
      const a = accMap.get(page);
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
      if (lvl0) a._lvl0Counts.set(lvl0, (a._lvl0Counts.get(lvl0) || 0) + 1);
      if (a.content_text.length < 40000) a.content_text += (a.content_text ? '\n' : '') + (f.content_text || '').slice(0, 4000);
      (f.search_keywords || []).forEach(k => a.keywords.add(k));
      // Links
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
        } catch { /* ignore */ }
      }
    }

    // Finalize docs and index
    const docs = [];
    for (const a of accMap.values()) {
      if (a._lvl0Counts.size) a.title = Array.from(a._lvl0Counts.entries()).sort((x,y)=>y[1]-x[1])[0][0];
      const emb = buildHashedEmbedding(a.content_text || '', 256);
      docs.push({
        id: a.id, url: a.url, host: a.host, title: a.title,
        fragment_ids: a.fragment_ids, fragment_count: a.fragment_count,
        life_events: Array.from(a.life_events), categories: Array.from(a.categories), states: Array.from(a.states),
        provider: Array.from(a.provider), governance: Array.from(a.governance), stage: Array.from(a.stage), stage_variant: Array.from(a.stage_variant),
        content_text: a.content_text, keywords: Array.from(a.keywords),
        embedding: emb, out_links: Array.from(a.out_links).slice(0, 500), out_link_tokens: Array.from(a.out_link_tokens).slice(0, 1000),
        crawl_version: CRAWL_VERSION, last_seen_at: Date.now()
      });
    }

    const coll = typesense.collections('content_pages').documents();
    let indexed = 0;
    for (let i = 0; i < docs.length; i += 100) {
      const batch = docs.slice(i, i + 100);
      try { await coll.import(batch, { action: 'upsert' }); indexed += batch.length; }
      catch (e) { for (const d of batch) { try { await coll.upsert(d); indexed++; } catch {} } }
    }

    if (prune) {
      try { await typesense.collections('content_pages').documents().delete({ filter_by: `crawl_version:<${CRAWL_VERSION}` }); } catch {}
    }

    res.json({ pages_indexed: indexed, pages_total: docs.length, fragments_processed: scoped.length });
  } catch (e) {
    console.error('pages/rebuild error:', e);
    res.status(500).json({ error: 'pages rebuild failed', message: e.message });
  }
});
