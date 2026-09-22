// Jev client. Questions and thresholds here are the ones verified in test/.
// Do not change the instructions without re-running test/run.sh — the
// thresholds below are fitted to this exact wording.

const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
const MODEL = 'jev-latest';

export const THRESHOLDS = { slop: 0.6, corporate: 0.7 };

const QUESTIONS = {
  is_slop: {
    type: 'noul',
    instructions:
      'This is a LinkedIn post. Is it low-value engagement-farming content ' +
      'written to a formula rather than to communicate something specific? ' +
      'Formulaic markers include: one-line paragraphs used for dramatic pacing, ' +
      'a manufactured hook, a generic life lesson, a numbered list of platitudes, ' +
      'and an explicit call to comment, repost or save.',
  },
  is_corporate_slop: {
    type: 'noul',
    instructions:
      'This is a LinkedIn post. Is it corporate or brand marketing content ' +
      'rather than a person speaking? Markers include: first-person plural on ' +
      'behalf of a company, award or milestone announcements, press-release ' +
      'phrasing, gratitude to the team and customers, and hashtag clusters.',
  },
  category: {
    type: 'choice',
    instructions: 'Classify what kind of LinkedIn post this is.',
    criteria: {
      engagement_bait:
        'Formulaic post engineered for reach; generic advice, fake vulnerability, ' +
        'or an explicit ask to comment/repost/save',
      humblebrag: 'Primarily announces the authors own success or status',
      genuine_update:
        'A specific, concrete update, experience, or piece of information from ' +
        'the authors actual work or life',
      job_or_notice: 'A job posting, event announcement, or practical notice',
    },
  },
};

/**
 * The stamp face comes from which judgment crossed its threshold, not from the
 * category. A corporate post can be categorised `genuine_update` and still be
 * brand marketing, which is why the category alone produced generic stamps.
 */
const labelFor = ({ slop, corporate, category }) => {
  if (corporate >= THRESHOLDS.corporate) return 'Corp';
  if (category === 'humblebrag') return 'Brag';
  if (slop >= THRESHOLDS.slop) return 'Bait';
  return 'Slop';
};

export class JevError extends Error {}

export const judge = async (postText, apiKey) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      state: { linkedin_post: postText },
      model: MODEL,
      questions: QUESTIONS,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new JevError(`Jev returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const { answers } = await response.json();
  const slop = answers.is_slop.noul;
  const corporate = answers.is_corporate_slop.noul;

  const verdict =
    slop >= THRESHOLDS.slop || corporate >= THRESHOLDS.corporate ? 'hide' : 'show';

  const category = answers.category.choice;

  return {
    verdict,
    slop,
    corporate,
    label: labelFor({ slop, corporate, category }),
    reason: category,
    confidence: answers.category.confidence,
    source: 'jev',
  };
};
