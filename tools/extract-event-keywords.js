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
  'Toddlers and preschoolers': 'https://my.gov.au/en/services/raising-kids/toddlers-and-preschoolers',
  'Primary school children': 'https://my.gov.au/en/services/raising-kids/primary-school-children',
  'Teenagers': 'https://my.gov.au/en/services/raising-kids/teenagers',
  'Separated parents': 'https://my.gov.au/en/services/raising-kids/separated-parents',
  'Finding, renting and buying a home': 'https://my.gov.au/en/services/living-arrangements/finding-renting-and-buying-a-home',
  'Experiencing a natural disaster': 'https://my.gov.au/en/services/living-arrangements/experiencing-a-natural-disaster',
  'Experiencing family and domestic violence': 'https://my.gov.au/en/services/living-arrangements/experiencing-family-and-domestic-violence',
  'Travelling overseas': 'https://my.gov.au/en/services/living-arrangements/travelling-overseas',
  'Experiencing crime and other risks online': 'https://my.gov.au/en/services/living-arrangements/experiencing-crime-and-other-risks-online',
  'Coming to Australia': 'https://my.gov.au/en/services/living-arrangements/coming-to-australia',
  'Retirement': 'https://my.gov.au/en/services/ageing/retirement',
  'Health and safety as you get older': 'https://my.gov.au/en/services/ageing/health-and-safety-as-you-get-older',
  'Accessing aged care services': 'https://my.gov.au/en/services/ageing/accessing-aged-care-services',
  'Planning for end of life': 'https://my.gov.au/en/services/ageing/planning-for-end-of-life',
  'Recently unemployed': 'https://my.gov.au/en/services/work/recently-unemployed',
  'Looking for work': 'https://my.gov.au/en/services/work/looking-for-work',
  'Starting a job': 'https://my.gov.au/en/services/work/starting-a-job',
  'Currently employed': 'https://my.gov.au/en/services/work/currently-employed',
  'Returning to work': 'https://my.gov.au/en/services/work/returning-to-work',
  'Managing the cost of living': 'https://my.gov.au/en/services/work/managing-the-cost-of-living',
  'Starting a job': 'https://my.gov.au/en/services/work/starting-a-job',
  'Vocational education and training': 'https://my.gov.au/en/services/education/vocational-education-and-training',
  'Higher education': 'https://my.gov.au/en/services/education/vocational-education-and-training',
  'Help when studying': 'https://my.gov.au/en/services/education/help-when-studying',
  'Upgrading professional skills or qualifications': 'https://my.gov.au/en/services/education/upgrading-professional-skills-or-qualifications',
  'Doing an apprenticeship': 'https://my.gov.au/en/services/education/doing-an-apprenticeship',
  'Seeking medical help': 'https://my.gov.au/en/services/health-and-disability/seeking-medical-help',
  'Being diagnosed with a medical condition or disability': 'https://my.gov.au/en/services/health-and-disability/being-diagnosed-with-a-medical-condition-or-disability',
  'Mental health': 'https://my.gov.au/en/services/health-and-disability/mental-health',
  'Caring for someone': 'https://my.gov.au/en/services/health-and-disability/caring-for-someone',
  'Experiencing the death of a loved one': 'https://my.gov.au/en/services/health-and-disability/experiencing-the-death-of-a-loved-one',
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
