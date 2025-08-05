#!/usr/bin/env node
/**
 * tools/expand-stage-synonyms.js
 *
 * Fetch synonyms for each harvested stage title using the Datamuse API
 * and merge them into data/seed-taxonomies.json under each lifeEvent.stages[title].
 *
 * Usage:
 *   node tools/expand-stage-synonyms.js
 *
 * Note: Requires network access to api.datamuse.com
 */
const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

const seedPath = path.resolve(__dirname, '../data/seed-taxonomies.json');
if (!fs.existsSync(seedPath)) {
  console.error('ERROR: seed-taxonomies.json not found at', seedPath);
  process.exit(1);
}

// Backup the seed file
const backupPath = seedPath + '.pre-synonyms.bak';
fs.copyFileSync(seedPath, backupPath);
console.log(`Backup created at ${backupPath}`);

// Load seed
const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

// Helper to pause between API calls
const delay = ms => new Promise(res => setTimeout(res, ms));

(async () => {
  for (const [eventName, eventObj] of Object.entries(seedData.lifeEvents)) {
    const stageTitles = Object.keys(eventObj.stages || {});
    if (!stageTitles.length) continue;
    console.log(`\nLifeEvent: ${eventName}`);
    for (const title of stageTitles) {
      // Skip if already has synonyms
      if (Array.isArray(eventObj.stages[title]) && eventObj.stages[title].length > 0) {
        console.log(`  - Skipping existing synonyms for "${title}"`);
        continue;
      }
      console.log(`  - Fetching synonyms for "${title}"`);
      try {
        const resp = await axios.get('https://api.datamuse.com/words', {
          params: { ml: title, max: 8 }
        });
        const words = resp.data.filter(w => w.word && !w.word.includes(' '));
        const synonyms = words.slice(0, 5).map(w => w.word);
        eventObj.stages[title] = synonyms;
        console.log(`    ✔  ${synonyms.join(', ')}`);
      } catch (err) {
        console.error(`    ✖  Error fetching for "${title}":`, err.message);
      }
      // avoid hammering the API
      await delay(300);
    }
  }

  // Write back
  fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2));
  console.log(`\n✅  seed-taxonomies.json updated with stage synonyms.`);
})();
