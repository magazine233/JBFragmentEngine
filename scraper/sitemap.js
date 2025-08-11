// scraper/sitemap.js
const { parseStringPromise } = require('xml2js');
const fetch = require('node-fetch');

async function fetchSitemapUrls(baseUrl) {
  const urls = new Set();
  
  try {
    // Try common sitemap locations
    const sitemapUrls = [
      `${baseUrl}/sitemap.xml`,
      `${baseUrl}/sitemap_index.xml`,
      `${baseUrl}/sitemap-index.xml`
    ];
    
    for (const sitemapUrl of sitemapUrls) {
      try {
        const response = await fetch(sitemapUrl);
        if (!response.ok) continue;
        
        const xml = await response.text();
        const result = await parseStringPromise(xml);
        
        // Handle sitemap index
        if (result.sitemapindex) {
          const sitemaps = result.sitemapindex.sitemap || [];
          for (const sitemap of sitemaps) {
            const childUrls = await fetchSitemapUrls(sitemap.loc[0]);
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
