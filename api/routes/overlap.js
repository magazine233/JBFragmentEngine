// api/routes/overlap.js
const express = require('express');
const router = express.Router();

// Utility: normalize and tokenize text
function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS = new Set([
  'the','is','at','which','on','a','an','and','or','but','in','with','to','for','of','as','by','that','this','it','from','are','be','was','were','been','being','have','has','had','do','does','did','will','would','should','could','may','might','can','cannot','not','your','you','we','our','us','their','they','them','about','more','info','information'
]);

function tokens(text, { dropStopwords = true } = {}) {
  const norm = normalizeText(text);
  const toks = norm.split(' ').filter(Boolean);
  return dropStopwords ? toks.filter(t => !STOPWORDS.has(t)) : toks;
}

function tokenSet(text, opts) {
  return new Set(tokens(text, opts));
}

function jaccard(setA, setB) {
  if (!setA.size && !setB.size) return 1;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function getHostname(doc) {
  if (Array.isArray(doc.site_hierarchy) && doc.site_hierarchy.length > 0) {
    return doc.site_hierarchy[0];
  }
  try {
    return new URL(doc.url).hostname;
  } catch {
    return '';
  }
}

function titleKey(title) {
  // Signature of top 5 alphanumeric tokens (sorted)
  const toks = tokens(title).slice(0, 12);
  const uniq = Array.from(new Set(toks));
  uniq.sort();
  return uniq.slice(0, 5).join('_');
}

const GENERIC_TITLES = new Set([
  'on this page','overview','introduction','contents','related information','see also','further information','more information','contact us','help','footer','navigation','quick links','table of contents','summary','related links','useful links','about','about us','site map','sitemap'
]);
const GENERIC_SHORT = new Set([
  'overview','introduction','contents','summary','information','help','contact','contacts','links','related','about'
]);

function isGenericTitle(title) {
  const t = (title || '').toLowerCase().trim();
  if (!t) return true;
  if (GENERIC_TITLES.has(t)) return true;
  const toks = tokens(t);
  // Only treat as generic if very short AND made of generic words/stopwords
  if (toks.length <= 2) {
    const informative = toks.some(x => !STOPWORDS.has(x) && !GENERIC_SHORT.has(x));
    if (!informative) return true;
  }
  return false;
}

// Extract outbound link tokens from content_html (hosts + first path segment)
function linkTokenSet(html) {
  const set = new Set();
  if (!html) return set;
  const hrefs = Array.from(html.matchAll(/href\s*=\s*"([^"]+)"/gi)).map(m => m[1]);
  for (const h of hrefs) {
    try {
      const u = new URL(h, 'https://example.org');
      const host = (u.hostname || '').toLowerCase();
      if (!host) continue;
      const seg = (u.pathname || '/').split('/').filter(Boolean)[0] || '';
      set.add(host);
      if (seg) set.add(host + '/' + seg.toLowerCase());
    } catch { /* ignore */ }
  }
  return set;
}

// Fetch all fragments (paged) from Typesense
async function fetchAllFragments(client, fields, limit = 20000) {
  const perPage = 250;
  let page = 1;
  let out = [];
  while (out.length < limit) {
    const res = await client
      .collections('content_fragments')
      .documents()
      .search({ q: '*', query_by: 'title', include_fields: fields.join(','), per_page: perPage, page });
    if (!res.hits || res.hits.length === 0) break;
    out = out.concat(res.hits.map(h => h.document));
    if (res.found <= page * perPage) break;
    page++;
  }
  return out.slice(0, limit);
}

router.get('/', async (req, res) => {
  try {
    const typesense = req.app.locals.typesense;
    const siteA = req.query.site_a || 'servicesaustralia.gov.au';
    const siteB = req.query.site_b || 'my.gov.au';
    const simThreshold = Math.min(Math.max(parseFloat(req.query.threshold || '0.55'), 0), 1);
    const maxPairs = parseInt(req.query.max_pairs || '500', 10);
    const aggregate = (req.query.aggregate || '').toLowerCase(); // 'page'
    const metric = (req.query.metric || 'combined').toLowerCase(); // combined|title|content|link
    const ignoreGeneric = String(req.query.ignore_generic || 'true') === 'true';

    const includeFields = [
      'id','url','title','content_text','site_hierarchy','life_events','categories','provider','governance','stage','stage_variant'
    ];
    if (metric === 'link') includeFields.push('content_html');

    const docs = await fetchAllFragments(typesense, includeFields);
    // Partition by hostname
    const A = [];
    const B = [];
    for (const d of docs) {
      const host = getHostname(d);
      if (host.endsWith(siteA)) A.push(d);
      else if (host.endsWith(siteB)) B.push(d);
    }
    // Precompute totals per base page for coverage denominators
    const aTotals = new Map();
    const bTotals = new Map();
    for (const d of A) { const bu = baseUrl(d.url); aTotals.set(bu, (aTotals.get(bu) || 0) + 1); }
    for (const d of B) { const bu = baseUrl(d.url); bTotals.set(bu, (bTotals.get(bu) || 0) + 1); }

    // Build indices for B
    const bByTitleKey = new Map();
    const bTokenIndex = new Map(); // token -> Set(docIndex)
    const bContentTokens = [];
    const bTitleTokens = [];
    const bLinkTokens = [];
    const bContentIndex = new Map(); // token -> Set(docIndex)
    for (let i = 0; i < B.length; i++) {
      const d = B[i];
      const k = titleKey(d.title || '');
      if (!bByTitleKey.has(k)) bByTitleKey.set(k, []);
      bByTitleKey.get(k).push(i);
      const tToks = tokenSet(d.title || '');
      const cToks = tokenSet((d.content_text || '').slice(0, 4000)); // cap length
      bTitleTokens[i] = tToks;
      bContentTokens[i] = cToks;
      bLinkTokens[i] = linkTokenSet(d.content_html);
      for (const t of tToks) {
        if (!bTokenIndex.has(t)) bTokenIndex.set(t, new Set());
        bTokenIndex.get(t).add(i);
      }
      // Build a lightweight content token index (limit tokens per doc to reduce fan-out)
      let added = 0;
      for (const t of cToks) {
        if (added >= 50) break;
        if (t.length < 4) continue; // skip very short tokens
        if (!bContentIndex.has(t)) bContentIndex.set(t, new Set());
        bContentIndex.get(t).add(i);
        added++;
      }
    }

    // Find candidate matches and score
    const pairs = [];
    const seenPairs = new Set();
    for (const a of A) {
      if (ignoreGeneric && isGenericTitle(a.title)) continue;
      const aTitleSet = tokenSet(a.title || '');
      const aContentSet = tokenSet((a.content_text || '').slice(0, 4000));
      const aLinkSet = linkTokenSet(a.content_html);
      const k = titleKey(a.title || '');

      const candidateIdx = new Set();
      // Exact-ish title signature match
      (bByTitleKey.get(k) || []).forEach(i => candidateIdx.add(i));
      // Title token overlap candidates
      for (const t of aTitleSet) {
        const idxs = bTokenIndex.get(t);
        if (idxs) idxs.forEach(i => candidateIdx.add(i));
      }
      // Content token overlap candidates (limited)
      let addedTokens = 0;
      for (const t of aContentSet) {
        if (addedTokens >= 30) break;
        if (t.length < 4) continue;
        const idxs = bContentIndex.get(t);
        if (idxs) { idxs.forEach(i => candidateIdx.add(i)); addedTokens++; }
      }

      for (const i of candidateIdx) {
        const b = B[i];
        if (ignoreGeneric && isGenericTitle(b.title)) continue;
        const key = `${a.id}|${b.id}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);

        const titleSim = jaccard(aTitleSet, bTitleTokens[i]);
        const contentSim = jaccard(aContentSet, bContentTokens[i]);
        const linkSim = jaccard(aLinkSet, bLinkTokens[i]);
        let score;
        if (metric === 'title') score = titleSim;
        else if (metric === 'content') score = contentSim;
        else if (metric === 'link') score = linkSim;
        else score = 0.4 * titleSim + 0.5 * contentSim + 0.1 * linkSim;
        if (score >= simThreshold) {
          // Overlapping tags
          const leOverlap = intersect(a.life_events || [], b.life_events || []);
          const catOverlap = intersect(a.categories || [], b.categories || []);
          pairs.push({
            a: { id: a.id, url: a.url, title: a.title, life_events: a.life_events, categories: a.categories },
            b: { id: b.id, url: b.url, title: b.title, life_events: b.life_events, categories: b.categories },
            title_sim: +titleSim.toFixed(3),
            content_sim: +contentSim.toFixed(3),
            link_sim: +linkSim.toFixed(3),
            score: +score.toFixed(3),
            overlaps: { life_events: leOverlap, categories: catOverlap }
          });
        }
      }
    }

    // Sort and trim
    pairs.sort((x, y) => y.score - x.score);
    const topPairs = pairs.slice(0, maxPairs);

    // Aggregate stats by tags
    const agg = {
      life_events: aggregateOverlap(topPairs, p => p.overlaps.life_events),
      categories: aggregateOverlap(topPairs, p => p.overlaps.categories)
    };

    // Page-level aggregation if requested
    if (aggregate === 'page') {
      const pageAgg = aggregateByPage(topPairs, aTotals, bTotals);
      const format = (req.query.format || 'json').toLowerCase();
      if (format === 'csv') {
        const Papa = require('papaparse');
        const csv = Papa.unparse(pageAgg, { header: true, skipEmptyLines: true });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="overlap_pages_export.csv"');
        return res.send(csv);
      }
      return res.json({
        params: { site_a: siteA, site_b: siteB, threshold: simThreshold, max_pairs: maxPairs, aggregate, metric, ignore_generic: ignoreGeneric },
        counts: { site_a_docs: A.length, site_b_docs: B.length, candidate_pairs: pairs.length, returned_pairs: topPairs.length },
        top_pages: pageAgg
      });
    }

    const format = (req.query.format || 'json').toLowerCase();
    if (format === 'csv') {
      const Papa = require('papaparse');
      const rows = topPairs.map(p => ({
        a_id: p.a.id,
        a_url: p.a.url,
        a_title: p.a.title,
        b_id: p.b.id,
        b_url: p.b.url,
        b_title: p.b.title,
        score: p.score,
        title_sim: p.title_sim,
        content_sim: p.content_sim,
        link_sim: p.link_sim,
        overlap_life_events: (p.overlaps.life_events || []).join('|'),
        overlap_categories: (p.overlaps.categories || []).join('|')
      }));
      const csv = Papa.unparse(rows, { header: true, skipEmptyLines: true });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="overlap_export.csv"');
      return res.send(csv);
    }

    const debug = String(req.query.debug || 'false') === 'true';
    const payload = {
      params: { site_a: siteA, site_b: siteB, threshold: simThreshold, max_pairs: maxPairs, metric, ignore_generic: ignoreGeneric },
      counts: { site_a_docs: A.length, site_b_docs: B.length, candidate_pairs: pairs.length, returned_pairs: topPairs.length },
      top_overlaps: agg,
      top_pairs: topPairs
    };
    if (debug) {
      // Include some diagnostics without heavy data
      payload.debug = {
        sample_a_hosts: Array.from(new Set(A.slice(0,100).map(getHostname))),
        sample_b_hosts: Array.from(new Set(B.slice(0,100).map(getHostname))),
        site_a: siteA,
        site_b: siteB
      };
    }
    res.json(payload);
  } catch (error) {
    console.error('Overlap analysis error:', error);
    res.status(500).json({ error: 'Overlap analysis failed', message: error.message });
  }
});

function intersect(a, b) {
  const setB = new Set(b);
  return Array.from(new Set(a.filter(x => setB.has(x))));
}

function aggregateOverlap(pairs, getter) {
  const counts = new Map();
  for (const p of pairs) {
    const vals = getter(p) || [];
    for (const v of vals) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const list = Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
  return list;
}

function baseUrl(url) {
  try { const u = new URL(url); u.hash = ''; u.search = ''; return u.toString(); } catch { return url.split('#')[0]; }
}

function aggregateByPage(pairs, aTotals, bTotals) {
  // Tally by base page URL pairs
  const stats = new Map(); // key -> {a_url,b_url, match_count, sum_score, max_score, a_frags:Set, b_frags:Set}
  const aCounts = new Map(aTotals); // base url -> total fragments on that page
  const bCounts = new Map(bTotals);

  for (const p of pairs) {
    const aBase = baseUrl(p.a.url);
    const bBase = baseUrl(p.b.url);
    // totals already captured
    const key = aBase + '|' + bBase;
    if (!stats.has(key)) stats.set(key, { a_url: aBase, b_url: bBase, match_count: 0, sum_score: 0, max_score: 0, a_ids: new Set(), b_ids: new Set() });
    const rec = stats.get(key);
    rec.match_count += 1;
    rec.sum_score += p.score;
    rec.max_score = Math.max(rec.max_score, p.score);
    rec.a_ids.add(p.a.id);
    rec.b_ids.add(p.b.id);
  }

  const rows = Array.from(stats.values()).map(r => {
    const a_total = aCounts.get(r.a_url) || r.a_ids.size; // fallback
    const b_total = bCounts.get(r.b_url) || r.b_ids.size;
    const cov_a = r.a_ids.size / Math.max(1, a_total);
    const cov_b = r.b_ids.size / Math.max(1, b_total);
    const coverage = (cov_a + cov_b) / 2;
    const avg_score = r.sum_score / Math.max(1, r.match_count);
    return {
      a_url: r.a_url,
      b_url: r.b_url,
      a_fragments: a_total,
      b_fragments: b_total,
      matched_fragments: r.match_count,
      a_matched_unique: r.a_ids.size,
      b_matched_unique: r.b_ids.size,
      coverage: +coverage.toFixed(3),
      avg_score: +avg_score.toFixed(3),
      max_score: +r.max_score.toFixed(3)
    };
  });

  rows.sort((x, y) => (y.coverage * y.avg_score) - (x.coverage * x.avg_score));
  return rows.slice(0, 500);
}

module.exports = router;
