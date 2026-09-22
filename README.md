# Slop Filter for LinkedIn

Slams a rubber stamp — BAIT, CORP, BRAG — onto engagement-bait and corporate PR
in the LinkedIn feed. The post stays readable underneath. Local keyword rules
run first; only genuinely uncertain posts are sent to Jev.

## Run

```bash
cd server && npm start          # holds the API key, listens on 127.0.0.1:8787
```

Then load `extension/` at `chrome://extensions` with Developer mode on, and
open LinkedIn.

## Why a server

The API key never enters the extension. Anything bundled into a Chrome
extension is readable by everyone who installs it.

## Stamp

Opaque tinted fill, so the post underneath is covered rather than washed.
Sized in JS against the card width, then measured and shrunk once because
rotation widens the footprint. Each stamp gets its own tilt so a feed of them
looks hand-stamped. Slam runs 380ms: enters at 5.2x scale with motion blur, squashes to 0.84,
overshoots to 1.06, settles; a shock ring fires off the bottom-out and the card
recoils 150ms later. Transform and opacity only (plus a blur that resolves to
zero); honours `prefers-reduced-motion`.

Preview it without LinkedIn:

```bash
python3 -m http.server 8899      # from the repo root
open http://127.0.0.1:8899/test/stamp-preview.html
```

## Selectors

LinkedIn hashes every class name and rotates them each build. The only durable
hook is `[componentkey*="FeedType_MAIN_FEED"]`. LinkedIn nests two of those per
post, so `scan()` keeps outermost matches only — otherwise every post is judged
and billed twice.

## Thresholds

`is_slop >= 0.60` or `is_corporate_slop >= 0.70` collapses the post. These are
fitted to the exact question wording in `server/jev.js` — re-run `test/run.sh`
after changing it.

Measured on 14 labelled samples:

| Group | is_slop | is_corporate |
|---|---|---|
| Engagement bait (4) | 0.87–0.94 | 0.09 |
| Genuine posts (4) | 0.10–0.13 | 0.06–0.09 |
| Corporate PR (3) | 0.23–0.27 | 0.98 |
| Ambiguous (3) | 0.26–0.35 | 0.07–0.64 |

Zero false positives. Nothing genuine scored above 0.35 on `is_slop`.

## Failure behaviour

If the proxy is down or Jev errors, every post stays visible. A broken
judgment must never hide a real post.

## Test

```bash
./test/run.sh                   # prints per-sample scores against samples.json
```
