// scraper/srrs.js
// Compute Holmes & Rahe Social Readjustment Rating Scale (SRRS) score for a fragment

const SRRS_WEIGHTS = {
  'death of spouse': 100,
  'divorce': 73,
  'marital separation': 65,
  'death of close family member': 63,
  'personal injury or illness': 53,
  'marriage': 50,
  'dismissal from work': 47,
  'marital reconciliation': 45,
  'retirement': 45,
  'pregnancy': 40,
  'gain a new family member': 39,
  'business readjustment': 39,
  'change in financial state': 38,
  'change to a different line of work': 36,
  'change in living conditions': 25,
  'start or end school': 26,
  'change in residence': 20,
  'change in work hours or conditions': 20,
};

function weightFor(text) {
  if (!text) return 0;
  const n = String(text).toLowerCase();
  if (/(death of (a )?spouse|widow|widower)/.test(n)) return SRRS_WEIGHTS['death of spouse'];
  if (/(divorce|relationship breakdown)/.test(n)) return SRRS_WEIGHTS['divorce'];
  if (/(separation|separated)/.test(n)) return SRRS_WEIGHTS['marital separation'];
  if (/(death of (close )?family|death of someone close|bereavement)/.test(n)) return SRRS_WEIGHTS['death of close family member'];
  if (/(injury|illness|diagnosed|health change|serious injury|disability|mental illness)/.test(n)) return SRRS_WEIGHTS['personal injury or illness'];
  if (/(marriage|getting married)/.test(n)) return SRRS_WEIGHTS['marriage'];
  if (/(pregnancy|having a baby|newborn)/.test(n)) return Math.max(SRRS_WEIGHTS['pregnancy'], SRRS_WEIGHTS['gain a new family member']);
  if (/(new family member|adopt|adoption)/.test(n)) return SRRS_WEIGHTS['gain a new family member'];
  if (/(job loss|lost my job|dismissal|redundant|unemploy)/.test(n)) return SRRS_WEIGHTS['dismissal from work'];
  if (/(reconcil|back together)/.test(n)) return SRRS_WEIGHTS['marital reconciliation'];
  if (/(retire|retirement|pension)/.test(n)) return SRRS_WEIGHTS['retirement'];
  if (/(business readjustment|restructure)/.test(n)) return SRRS_WEIGHTS['business readjustment'];
  if (/(financial (state|situation) change|income drop|income change|debt)/.test(n)) return SRRS_WEIGHTS['change in financial state'];
  if (/(change (of|in) (career|line of work)|career change)/.test(n)) return SRRS_WEIGHTS['change to a different line of work'];
  if (/(moving house|move house|relocat|change of address|change in residence)/.test(n)) return SRRS_WEIGHTS['change in residence'];
  if (/(housing|living conditions|homeless|no fixed address)/.test(n)) return SRRS_WEIGHTS['change in living conditions'];
  if (/(start(ing)? school|end(ing)? school|university|study)/.test(n)) return SRRS_WEIGHTS['start or end school'];
  if (/(work hours|shift work|conditions at work)/.test(n)) return SRRS_WEIGHTS['change in work hours or conditions'];
  return 0;
}

function computeSRRSScore(fragment) {
  let maxWeight = 0;
  // Prefer explicit life_events first
  const evs = [];
  if (Array.isArray(fragment.life_events)) evs.push(...fragment.life_events);
  if (fragment.stage) evs.push(fragment.stage);
  if (fragment.stage_variant) evs.push(fragment.stage_variant);
  for (const ev of evs) {
    maxWeight = Math.max(maxWeight, weightFor(ev));
  }
  // Fallback to text/title
  if (maxWeight === 0) {
    maxWeight = Math.max(
      weightFor(fragment.title),
      weightFor(fragment.content_text)
    );
  }
  // Clamp to 0..100 int
  maxWeight = Math.max(0, Math.min(100, Math.round(maxWeight)));
  return maxWeight;
}

module.exports = { computeSRRSScore };

