// scraper/multi-scrape.js
const MyGovScraper = require('./scraper');
const cfg = require('../config/scraper-config');

async function main() {
  const raw = process.env.TARGET_URLS || '';
  // Default to both sites if not provided
  const targets = raw
    ? raw.split(',').map(s => s.trim()).filter(Boolean)
    : [
        'https://my.gov.au',
        'https://www.servicesaustralia.gov.au'
      ];

  console.log(`Starting multi-site crawl for ${targets.length} target(s)`);

  for (const url of targets) {
    const scraper = new MyGovScraper(cfg); // fresh instance per target to reset state
    console.log(`\n=== Crawling target: ${url} ===`);
    try {
      await scraper.run(url);
    } catch (e) {
      console.error(`Target failed: ${url}`, e.message);
    }
  }

  console.log('\nAll targets completed.');
}

main().catch(err => { console.error(err); process.exit(1); });
