// Local proxy. The API key stays here and never reaches the browser —
// anything shipped inside a Chrome extension is readable by everyone
// who installs it.

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { prefilter } from './prefilter.js';
import { judge, JevError } from './jev.js';

const PORT = Number(process.env.PORT ?? 8787);
const CACHE_LIMIT = 2000;
const MAX_BODY_BYTES = 256 * 1024;

const loadApiKey = () => {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  try {
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const match = env.match(/^TYPESAFE_API_KEY=(.*)$/m);
    if (match) return match[1].trim();
  } catch {
    // fall through to the explicit error below
  }
  throw new Error('TYPESAFE_API_KEY not found in environment or .env');
};

const API_KEY = loadApiKey();
const cache = new Map();
const stats = { local: 0, jev: 0, cached: 0, errors: 0 };

const remember = (key, value) => {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
};

const classify = async (text) => {
  const key = text.slice(0, 500);
  if (cache.has(key)) {
    stats.cached += 1;
    return cache.get(key);
  }

  const local = prefilter(text);
  if (local) {
    stats.local += 1;
    return remember(key, local);
  }

  const result = await judge(text, API_KEY);
  stats.jev += 1;
  return remember(key, result);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

// The content script calls from https://www.linkedin.com; the popup calls from
// chrome-extension://<id>. Allow exactly those two and nothing else.
const ALLOWED_ORIGIN = /^(https:\/\/www\.linkedin\.com|chrome-extension:\/\/[a-p]+)$/;

const send = (res, status, payload, origin) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
  if (origin && ALLOWED_ORIGIN.test(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(payload));
};

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (req.method === 'OPTIONS') return send(res, 204, {}, origin);
  if (req.url === '/stats') return send(res, 200, stats, origin);
  if (req.method !== 'POST' || req.url !== '/judge') {
    return send(res, 404, { error: 'Not found' }, origin);
  }

  try {
    const { posts } = JSON.parse(await readBody(req));
    if (!Array.isArray(posts)) {
      return send(res, 400, { error: 'Expected { posts: [{ id, text }] }' }, origin);
    }

    const results = await Promise.all(
      posts.map(async ({ id, text }) => {
        try {
          return { id, ...(await classify(String(text ?? ''))) };
        } catch (error) {
          stats.errors += 1;
          const isJev = error instanceof JevError;
          console.error(`[judge] ${id}: ${error.message}`);
          // Fail open. A broken judgment must never hide a real post.
          return { id, verdict: 'show', reason: isJev ? 'jev_error' : 'error' };
        }
      })
    );

    send(res, 200, { results }, origin);
  } catch (error) {
    stats.errors += 1;
    send(res, 400, { error: error.message }, origin);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`jev-slop-filter listening on http://127.0.0.1:${PORT}`);
  console.log('Load extension/ in chrome://extensions (Developer mode)');
});
