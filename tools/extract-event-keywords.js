#!/usr/bin/env node
/**
 * tools/extract-event-keywords.js
 *
 * Fetch each lifeEvent's parent page and its stage URLs,
 * extract main text content, compute TF-IDF across those docs,
 * and suggest top terms to augment your taxonomy keywords.
 *
 * Usage:
 *   npm install natural axios cheerio
 *   node tools/extract-event-keywords.js
 */
const fs      = require('fs');
const path    = require('path');
const axios   = require('axios');
const cheerio = require('cheerio');
const natural = require('natural');

// 1) Load seed-taxonomies
const seedPath = path.resolve(__dirname, '../data/seed-taxonomies.json');
if (!fs.existsSync(seedPath)) {
  console.error('ERROR: seed-taxonomies.json not found');
  process.exit(1);
}
const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

// 2) Map lifeEvent names to parent URLs (fill these if needed)
const eventUrlMap = {
  'Having a baby': 'https://my.gov.au/en/services/raising-kids/having-a-baby',
  'Work': 'https://my.gov.au/en/services/work',
  'Ageing': 'https://my.gov.au/en/services/ageing',
  'Education': 'https://my.gov.au/en/services/education',
  'Health and Disability': 'https://my.gov.au/en/services/health-and-disability',
  'Raising Kids': 'https://my.gov.au/en/services/raising-kids'
};

// 3) Helper to extract text from HTML
function extractText(html) {
  const $ = cheerio.load(html);
  // Focus on <main> content if available
  const $main = $('main, .cmp-list-gui, .cmp-container').first();
  return ($main.text() || $('body').text()).replace(/\s+/g, ' ').trim();
}

(async () => {
  for (const [eventName, eventObj] of Object.entries(seed.lifeEvents)) {
    const parentUrl = eventUrlMap[eventName];
    if (!parentUrl) continue;
    console.log(`\n🔍 Processing lifeEvent: ${eventName}`);

    // Gather URLs: parent + each stage URL
    const urls = [parentUrl];
    // stageValues may be an object mapping title->synonyms
    const stages = eventObj.stages || {};
    for (const title of Object.keys(stages)) {
      // if you harvested URLs, stage value might be object with url
      if (stages[title] && typeof stages[title] === 'object' && stages[title].url) {
        urls.push(stages[title].url);
      }
    }

    // Fetch and extract text for each doc
    const docs = [];
    for (const u of urls) {
      try {
        const res = await axios.get(u, { timeout: 10000 });
        docs.push({ url: u, text: extractText(res.data) });
      } catch (e) {
        console.warn(`  ⚠️  Fetch error for ${u}: ${e.message}`);
      }
    }

    if (docs.length === 0) continue;

    // Build TF-IDF
    const tfidf = new natural.TfIdf();
    docs.forEach(d => tfidf.addDocument(d.text));

    // Get top terms from the combined corpus (document 0 = parent)
    const terms = tfidf.listTerms(0)
      .filter(item => item.term.length > 3)
      .slice(0, 30)
      .map(item => item.term);

    // Filter out existing keywords
    const existing = eventObj.keywords || [];
    const suggestions = terms.filter(t => !existing.includes(t));

    console.log(`  ✔  Suggested: ${suggestions.slice(0, 10).join(', ')}`);

    // Attach to seed (under a new key)
    eventObj.pageKeywords = suggestions;
  }

  // Write out suggestions JSON (do not overwrite main seed)
  const outPath = path.resolve(__dirname, '../data/event-keyword-suggestions.json');
  fs.writeFileSync(outPath, JSON.stringify(seed, null, 2));
  console.log(`\n✅  Suggestions written to ${outPath}`);
})();
