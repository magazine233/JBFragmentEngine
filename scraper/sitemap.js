// scraper/sitemap.js
const { parseStringPromise } = require('xml2js');
const fetch = require('node-fetch');

async function fetchTextWithRetries(url, attempts = 3) {
  const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36';
  const headersBase = {
    'User-Agent': ua,
    'Accept': 'application/xml,text/xml,application/xhtml+xml,text/html;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-AU,en;q=0.9',
    'Connection': 'keep-alive'
  };
  const timeouts = [12000, 16000, 25000];
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    const timeout = timeouts[Math.min(i, timeouts.length - 1)];
    const headers = i === 0 ? headersBase : { ...headersBase, 'Cache-Control': 'no-cache' };
    try {
      const res = await fetch(url, { timeout, redirect: 'follow', headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, 500 * (i + 1)));
        continue;
      }
    }
  }
  throw lastErr;
}

async function fetchSitemapUrls(baseUrl, visited = new Set(), depth = 0) {
  const urls = new Set();
  const MAX_DEPTH = 3;
  const MAX_CHILD_SITEMAPS = 50;
  if (depth > MAX_DEPTH) return Array.from(urls);
  if (visited.has(baseUrl)) return Array.from(urls);
  visited.add(baseUrl);
  
  try {
    // Try common sitemap locations
    const sitemapUrls = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/sitemap-index.xml`
    ];
    
    for (const sitemapUrl of sitemapUrls) {
      try {
        const xml = await fetchTextWithRetries(sitemapUrl);
        const result = await parseStringPromise(xml);
        
        // Handle sitemap index
        if (result.sitemapindex) {
          const sitemaps = result.sitemapindex.sitemap || [];
          let processed = 0;
          for (const sitemap of sitemaps) {
            if (processed++ > MAX_CHILD_SITEMAPS) break;
            const childUrls = await fetchSitemapUrls(sitemap.loc[0], visited, depth + 1);
            childUrls.forEach(url => urls.add(url));
          }
        }
        
        // Handle regular sitemap
        if (result.urlset) {
          const urlEntries = result.urlset.url || [];
          urlEntries.forEach(entry => {
            if (entry.loc && entry.loc[0]) {
              urls.add(entry.loc[0]);
            }
          });
        }
        
        if (urls.size > 0) break; // Found urls, stop trying
      } catch (e) {
        console.error(`Failed to fetch sitemap from ${sitemapUrl}:`, e.message);
      }
    }
  } catch (e) {
    console.error('Sitemap fetch error:', e);
  }
  
  return Array.from(urls);
}

module.exports = { fetchSitemapUrls };
