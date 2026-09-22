// Watches the LinkedIn feed, sends unseen posts to the local Jev proxy,
// and slams a stamp onto the ones that come back as slop.

const ENDPOINT = 'http://127.0.0.1:8787/judge';
const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 350;
const MIN_TEXT_LENGTH = 40;

// LinkedIn hashes every class name and rotates them each build, so the only
// durable hook is the componentkey, which still carries the feed type.
const POST_SELECTORS = [
  '[componentkey*="FeedType_MAIN_FEED"]',
  'div.feed-shared-update-v2',            // older layout, harmless if absent
  'div[data-id^="urn:li:activity"]',
];

// Scored with textContent (cheap, no reflow); the winner is re-read with
// innerText because the line breaks are a slop signal in their own right.
const TEXT_CANDIDATES = 'p, span[dir], div[dir], div, span';
const WRAPPER_RATIO = 0.95;
const MAX_TEXT_LENGTH = 3000;

// The stamp face is decided server-side, where the thresholds live.

const seen = new WeakSet();
const queue = [];
const pending = new Map();
let counterEl = null;
let stampedCount = 0;
let timer = null;
let nextId = 0;

const settings = { enabled: true };

/**
 * Returns the post body. Any element holding ~all of the container's text is a
 * wrapper, not the body, so the body is the longest block strictly below that.
 */
const readText = (post) => {
  const total = (post.textContent ?? '').trim().length;
  if (total < MIN_TEXT_LENGTH) return '';

  const ceiling = total * WRAPPER_RATIO;
  let best = null;
  let bestLength = 0;

  for (const node of post.querySelectorAll(TEXT_CANDIDATES)) {
    const length = (node.textContent ?? '').trim().length;
    if (length > bestLength && length < ceiling) {
      bestLength = length;
      best = node;
    }
  }

  const text = ((best ?? post).innerText ?? '').trim();
  return text.length >= MIN_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH) : '';
};

const renderCounter = () => {
  if (!counterEl) {
    counterEl = document.createElement('div');
    counterEl.className = 'slop-counter';
    document.body.appendChild(counterEl);
  }
  counterEl.textContent = `${stampedCount} stamped`;
};

const stamp = (post, result) => {
  const word = result.label ?? 'Slop';
  const score = Math.max(result.slop ?? 0, result.corporate ?? 0);

  const mark = document.createElement('div');
  mark.className = 'slop-stamp';
  mark.dataset.reason = result.reason;

  const wordEl = document.createElement('span');
  wordEl.className = 'slop-word';
  wordEl.textContent = word;

  const metaEl = document.createElement('span');
  metaEl.className = 'slop-meta';
  metaEl.textContent = result.source === 'local' ? 'rule' : `jev ${score.toFixed(2)}`;

  mark.append(wordEl, metaEl);
  // Fit the word to the card and give each stamp its own tilt, so a feed of
  // them looks hand-stamped rather than CSS-generated.
  const width = post.clientWidth || 480;
  const tilt = -14 + Math.random() * 9;
  const size = Math.min(76, Math.max(22, (width * 0.74) / (word.length * 0.68)));
  mark.style.setProperty('--stamp-size', `${Math.round(size)}px`);
  mark.style.setProperty('--stamp-tilt', `${tilt}deg`);

  post.classList.add('slop-stamped');
  post.appendChild(mark);

  // Rotation widens the footprint, so the estimate above can still overhang the
  // card. Measure the untransformed box and shrink once to fit.
  const radians = Math.abs(tilt) * (Math.PI / 180);
  const footprint =
    mark.offsetWidth * Math.cos(radians) + mark.offsetHeight * Math.sin(radians);
  const limit = width * 0.8;
  if (footprint > limit) {
    mark.style.setProperty('--stamp-size', `${Math.round((size * limit) / footprint)}px`);
  }

  stampedCount += 1;
  renderCounter();
};

const apply = (results) => {
  for (const result of results) {
    const post = pending.get(result.id);
    pending.delete(result.id);
    if (!post?.isConnected) continue;
    post.classList.remove('slop-pending');
    if (result.verdict === 'hide') stamp(post, result);
  }
};

const flush = async () => {
  timer = null;
  const batch = queue.splice(0, BATCH_SIZE);
  if (batch.length === 0) return;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ posts: batch.map(({ id, text }) => ({ id, text })) }),
    });
    if (!response.ok) throw new Error(`proxy ${response.status}`);
    const { results } = await response.json();
    apply(results);
  } catch (error) {
    // Fail open: leave every post visible and stop pulsing it.
    console.warn('[slop-filter] proxy unreachable —', error.message);
    for (const { id } of batch) {
      pending.get(id)?.classList.remove('slop-pending');
      pending.delete(id);
    }
  }

  if (queue.length > 0) schedule();
};

const schedule = () => {
  if (timer !== null) return;
  timer = setTimeout(flush, BATCH_DELAY_MS);
};

const enqueue = (post) => {
  if (seen.has(post) || !settings.enabled) return;
  const text = readText(post);
  if (text.length < MIN_TEXT_LENGTH) return;

  seen.add(post);
  const id = post.getAttribute('componentkey') ?? `p${nextId++}`;
  pending.set(id, post);
  post.classList.add('slop-pending');
  queue.push({ id, text });
  schedule();
};

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      enqueue(entry.target);
    }
  },
  { rootMargin: '400px 0px' }
);

/**
 * LinkedIn nests two FeedType_MAIN_FEED containers per post, so a naive
 * querySelectorAll judges (and bills) every post twice. Keep only the
 * outermost match of each nest.
 */
const outermost = (nodes) =>
  nodes.filter((node) => !nodes.some((other) => other !== node && other.contains(node)));

const scan = () => {
  const found = new Set();
  for (const selector of POST_SELECTORS) {
    for (const post of document.querySelectorAll(selector)) found.add(post);
  }
  for (const post of outermost([...found])) {
    if (!seen.has(post)) observer.observe(post);
  }
};

chrome.storage.sync.get({ enabled: true }, (stored) => {
  settings.enabled = stored.enabled;
  if (!settings.enabled) return;
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  renderCounter();
});
