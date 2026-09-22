// Local rules run before Jev. Cheap, deterministic, and they catch the
// obvious cases so we only pay for the genuinely uncertain ones.

const BAIT_PHRASES = [
  'agree?', 'thoughts?', 'what do you think?', "that's the post",
  'repost if', '♻️', 'save this post', 'let that sink in',
  'unpopular opinion', 'here\'s what i learned', 'your move',
  'comment below', 'drop a', 'who else', 'am i the only one',
];

const CORPORATE_PHRASES = [
  'we are excited to announce', 'we are thrilled', 'proud to announce',
  'delighted to share', 'magic quadrant', 'great place to work',
  'testament to our', 'our greatest asset', 'we are hiring',
];

const MAX_SAFE_LENGTH = 180;

const countShortLines = (text) =>
  text.split('\n').filter((line) => {
    const t = line.trim();
    return t.length > 0 && t.length < 60;
  }).length;

const hits = (text, phrases) =>
  phrases.filter((p) => text.includes(p)).length;

/**
 * Returns a verdict without calling Jev when the answer is obvious,
 * or null when the post needs a real judgment.
 */
export const prefilter = (rawText) => {
  const text = rawText.toLowerCase();
  const baitHits = hits(text, BAIT_PHRASES);
  const corpHits = hits(text, CORPORATE_PHRASES);
  const shortLines = countShortLines(rawText);

  if (baitHits >= 2 && shortLines >= 4) {
    return { verdict: 'hide', reason: 'engagement_bait', source: 'local' };
  }
  if (corpHits >= 2) {
    return { verdict: 'hide', reason: 'corporate', source: 'local' };
  }
  if (rawText.length < MAX_SAFE_LENGTH && baitHits === 0 && corpHits === 0 && shortLines <= 2) {
    return { verdict: 'show', reason: 'short_and_plain', source: 'local' };
  }
  return null;
};
