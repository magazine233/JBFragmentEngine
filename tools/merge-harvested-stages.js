#!/usr/bin/env node
/**
 * tools/merge-harvested-stages.js
 *
 * Merge harvested stages from data/harvested-stages.json into data/seed-taxonomies.json.
 * Existing stage-level synonyms are preserved, new stages get empty arrays.
 * Usage:
 *   node tools/merge-harvested-stages.js
 */
const fs   = require('fs');
const path = require('path');

const seedPath      = path.resolve(__dirname, '../data/seed-taxonomies.json');
const harvestedPath = path.resolve(__dirname, '../data/harvested-stages.json');

if (!fs.existsSync(seedPath) || !fs.existsSync(harvestedPath)) {
  console.error('ERROR: Missing seed or harvested JSON.');
  process.exit(1);
}

const seedData      = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
const harvestedData = JSON.parse(fs.readFileSync(harvestedPath, 'utf8'));

// Backup original seed
const backupPath = seedPath + '.bak';
fs.copyFileSync(seedPath, backupPath);
console.log(`Backup of seed-taxonomies.json created at ${backupPath}`);

// Merge loop
for (const entry of harvestedData) {
  const { lifeEvent, stages } = entry;
  const eventSeed = seedData.lifeEvents[lifeEvent];
  if (!eventSeed) {
    console.warn(`⚠️  Life-event not found in seed: "${lifeEvent}"`);
    continue;
  }

  const oldStages = eventSeed.stages || {};
  const mergedStages = {};
  for (const { title } of stages) {
    // Preserve existing synonyms array if present, else empty
    mergedStages[title] = Array.isArray(oldStages[title]) ? oldStages[title] : [];
  }

  eventSeed.stages = mergedStages;
  console.log(`✅  Merged ${stages.length} stages into "${lifeEvent}"`);
}

// Write back
fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2));
console.log(`
✅  seed-taxonomies.json updated successfully.`);
