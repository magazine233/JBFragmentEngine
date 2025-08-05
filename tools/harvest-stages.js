#!/usr/bin/env node
/**
 * tools/harvest-stages.js
 *
 * Standalone script to auto-harvest "stages" for each lifeEvent from the live site.
 * Outputs JSON to data/harvested-stages.json
 *
 * Usage:
 *   node tools/harvest-stages.js
 *
 * Adjust `eventUrlMap` to point each lifeEvent name to its canonical URL.
 * Adjust `stageListSelectors` if the HTML structure differs.
 */
const axios   = require('axios');
const cheerio = require('cheerio');
const fs      = require('fs');
const path    = require('path');

// 1. Load existing seed-taxonomies.json
const seedPath = path.resolve(__dirname, '../data/seed-taxonomies.json');
if (!fs.existsSync(seedPath)) {
  console.error('ERROR: seed-taxonomies.json not found at', seedPath);
  process.exit(1);
}
const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

// 2. Map lifeEvent names to their canonical URLs for seed lifeEvents
const eventUrlMap = {
  'Having a baby': 'https://my.gov.au/en/services/raising-kids/having-a-baby',
  'Work': 'https://my.gov.au/en/services/work',
  'Ageing': 'https://my.gov.au/en/services/ageing',
  'Education': 'https://my.gov.au/en/services/education',
  'Health and Disability': 'https://my.gov.au/en/services/health-and-disability',
  'Raising Kids': 'https://my.gov.au/en/services/raising-kids'
};

// 3. CSS selectors to locate the stages list on each page
const stageListSelectors = [
  // New selector: gui-tile-list component for stage tiles
  'gui-tile-list.cmp-list-gui gui-tile > a',
  // Existing selector for earlier gui-tile list items
  'gui-tile[role="listitem"] > a',
  // Existing fallbacks
  'ul.stages-list li a',
  '.stage-steps li a',
  '.lifecycle-stages li a'
];

(async () => {
  const results = [];

  for (const eventName of Object.keys(seedData.lifeEvents)) {
    const url = eventUrlMap[eventName];
    if (!url) {
      console.warn(`⚠️  No URL mapped for "${eventName}"; skipping.`);
      continue;
    }
    try {
      console.log(`Fetching stages for "${eventName}" from ${url}`);
      const res = await axios.get(url, { timeout: 15000 });
      const $   = cheerio.load(res.data);

      let stageItems = [];
      for (const sel of stageListSelectors) {
        const elems = $(sel);
        if (elems.length) {
          stageItems = elems.toArray().map(el => {
          const $el = $(el);
          // Extract title: either direct text or from gui-tile-heading attribute
          let title = $el.text().trim();
          if (!title) {
            const headingAttr = $el.find('gui-tile-heading').attr('heading-text');
            title = headingAttr ? headingAttr.trim() : '';
          }
          const href = $el.attr('href');
          return { title, url: new URL(href, url).href };
        });
          console.log(`   ✓  Found ${stageItems.length} items with selector ${sel}`);
          break;
        }
      }

      if (!stageItems.length) {
        console.warn(`   ⚠️  No stages found for "${eventName}"; check your selectors.`);
      }
      results.push({ lifeEvent: eventName, stages: stageItems });
    } catch (err) {
      console.error(`   ❌  Error fetching ${url}:`, err.message);
    }
  }

  // 4. Write results to data/harvested-stages.json
  const outPath = path.resolve(__dirname, '../data/harvested-stages.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`
✅  Harvest complete. Output written to ${outPath}`);
})();
