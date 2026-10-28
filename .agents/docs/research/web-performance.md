# Web performance audit

Audited October 27, 2026 against `b700ed9d7` (production then ran v6.0.7, `19770b17b`, with byte-identical app
payloads). Nine independent auditors covered JavaScript bundles, served images, HTTP delivery, CSS and fonts, runtime
loading, public resume pages, TanStack Start, TanStack Redact and production field data. This page keeps their
conclusions, numbers and the ranked backlog. Their raw reports and scripts were written to `/tmp/rr-perf-audit/`
(not kept). Related: [redact.md](./redact.md).

Numbers are bytes unless stated. **gzip** is Node's default level 6, which is what `hono/compress` serves; **brotli**
is quality 11. Timings came from a shared, loaded machine (Chromium, 4× CPU, DevTools Fast 4G): trust their direction
and the request structure more than the absolute milliseconds.

## Answers

- **Move to TanStack Start? No, not now.** Marketing pages already ship prerendered HTML per locale, public resume
  pages are already server-rendered by Hono without the SPA, and the builder must stay a client app around the PDF
  engine. Start 1.169 became stable on October 12, 2026. In a controlled minimal app (same React, Router and Vite),
  Start with SSR shipped **+12.8 KB gzip (+13%)** more client JavaScript than a Router-only SPA. A migration touches
  about 43 files across rendering, request state, Hono, three deploy targets and CI, and needs request-isolated Lingui,
  deterministic theme/locale hydration and a CSP for streamed inline scripts. The visible startup delay comes from the
  root context waterfall and preview bytes, which Start does not remove. Revisit only if a measured pilot on the
  optimized baseline wins (see "Decision rule").
- **Redact: not worth it now; the opt-in build mode was removed** (evaluation in [redact.md](./redact.md)). The
  autofocus failure is a runtime gap: React DOM calls `.focus()` at commit for a newly
  mounted control with `autoFocus`; Redact only sets the `autofocus` attribute. Redact 0.2.1 (published October 27)
  still has it. Its feature flags can cut a further ~5 KB gzip, but two open upstream issues match this app's stack
  (Base UI submenus closing before a link click; large rerenders reported ~2× slower). Startup bytes are not
  interaction speed.
- **Images: done in this change** (below). The template previews were 300 dpi renders shown as small cards.

## Changed in this branch: served images

| What                                                                                                  |     Before |                  After |
| ----------------------------------------------------------------------------------------------------- | ---------: | ---------------------: |
| `templates/jpg/*.jpg` — 18 previews, 2481×3508 q94 → 600×848 mozjpeg q75, same URLs and format        | 22,736,185 |     1,206,549 (−94.7%) |
| `templates/thumb/*.webp` — 596×843, WebP q75                                                          |  1,272,398 |       1,007,394 (−21%) |
| `templates/thumb/*-small.webp` — new 300×424, used by the gallery's `srcSet`                          |          — |                288,876 |
| `illustrations/footer-desk-*-{1600,2400}.webp` — new `srcSet` siblings                                |          — |                514,634 |
| OG banner (q100 → q85), ATS card, sample photo (800 → 512 px), PWA icons, unreferenced `features.jpg` |    693,094 |                261,161 |
| **All of `apps/web/public`** (also the Docker image's copy)                                           | 30,656,516 | **9,233,453 (−69.9%)** |

- The builder's Design panel, the cover letter design panel and the mobile picker mount all 18 previews:
  **22.7 MB → 1.2 MB** when opened on a self-hosted server. rxresu.me's Cloudflare Polish converted them to WebP but
  did not resize them (gengar: 566,638 B). Mean SSIM 0.990 against a lossless 600 px render; 600 px covers every
  consumer at 3× (web cards up to 178 CSS px, mobile cards 112–178 dp, README 150 px).
- Old mobile builds and the README keep working: same URL, still JPEG, same aspect ratio.
- `srcSet`/`sizes` now let browsers pick smaller files. Checked in Chromium: the gallery at 1× loads the 300 px thumb
  (2× keeps 596 px); the footer at 1440@1× loads 1600 px and at 390@3× 2400 px instead of 3200 px; doodles at 1440@2×
  load the 400 px file instead of 800 px (hero first paint 248 → 88 KB measured by the auditor). Curve and globe
  upscale up to 1.15× on 2× screens (marked `ponytail:` in `ui.tsx`).
- The homepage contact sheet still loads the 596 px thumbs. Using the `-small` files there saves ~63% of the scene,
  but on 2× screens the sheet is visibly softer while it zooms out; that is a design call.
- `apps/web/DESIGN.md` (Template previews) holds the regeneration command; AGENTS.md's "New template" line points to
  it. The command reproduces the committed files byte for byte.
- **After deploying, purge the replaced URLs in Cloudflare** (`/templates/*`, `/opengraph/*`, `/photos/*`, the PWA
  icons). Public files carry no `Cache-Control`, so edge and Polish copies otherwise linger.

## Where the bytes and time go

- **Every page** loads 45 eager JS files: 340,880 gzip / 292,873 brotli (React DOM 63 KB, Base UI + floating-ui
  49 KB, zod 33 KB, Phosphor icon registry 33 KB, router 26 KB, Better Auth client 20 KB), plus a render-blocking
  stylesheet of 57.9 KB gzip of which a page uses about 15% (the homepage 33%).
- **Builder cold load** (HTTP/2): 7.7 MB, of which 6.2 MB is the preview — Forme WASM 3.2 MB gzip, the PDF worker,
  HarfBuzz, the pdf.js worker and nine fonts (1.76 MB, 1.1 MB of it Noto fallbacks requested whether or not any glyph
  needs them). First preview 10.4 s cold, 2.35 s warm. WASM compile is not the problem; bytes and serial chains are.
- **Serial chains:** session + flags + catalog start only after the whole JS graph evaluates; the dashboard's data
  request starts after its page renders; the pdf.js worker starts only after the first PDF exists; signed-out pages
  check the session twice in series.
- **Production delivery:** Cloudflare caches by file extension and its default list excludes `.wasm` and `.mjs`, so
  the 7 MB Forme WASM, HarfBuzz and the pdf.js worker are `cf-cache-status: DYNAMIC` despite `immutable` — every first
  builder or ATS visit pulls ~3.9 MB gzip from origin (~183 ms origin CPU). The zone serves gzip only, even to clients
  accepting brotli or zstd. Marketing HTML is never edge-cached (TTFB 156 ms vs 55 ms for a hit).
- **Public resume pages:** 425 KB first visit, 80% of it full TTF fonts from fonts.gstatic.com (14.9 MB for a Chinese
  resume); late fonts cause CLS 0.04–0.11. Server render is fast (~5 ms cached, 18–20 ms after an edit).
- **Self-hosters on HTTP/1.1** pay about double on a cold builder load (editor 5.7 s vs 2.4 s on HTTP/2).

## Ranked backlog

**Done since the audit (October 27, 2026):** the Cloudflare Cache Rule for `/assets/*` (owner; the WASM and `.mjs`
worker now return `HIT`), and four code changes: brotli copies written by the Docker build and served with
`precompressed: true`; preload `Link` headers for each page's stylesheet and fonts, for Early Hints; `Cache-Tag`
headers (`html` on pages, `public` on fixed-name files) so the release purge leaves hashed assets cached; and the
Cloudflare Web Analytics beacon allowed in `script-src`. The zone settings that make the last three take effect
(Early Hints, Web Analytics, a brotli Compression Rule) are owner actions.

### Owner actions in Cloudflare (no code)

1. Cache Rule: cache everything under `/assets/*` (honour origin TTL). Edge-caches the WASM and `.mjs` worker.
2. Compression Rule: offer brotli (and zstd) to visitors. Needed for item 1 of the next list to reach production;
   −15.6% on the shared JS/CSS (355,935 → 300,391 gzip vs brotli) and −27% on the homepage HTML.
3. Purge the replaced image URLs after this change deploys.
4. Optional: turn off Email Obfuscation (forces HTML recompression, injects a parser-blocking script twice on `/`).
   Edge-caching marketing HTML is possible but must bypass requests with a `locale` cookie (Cloudflare ignores
   `Vary: Cookie`) and depends on the release purge; keep its TTL at an hour or less.

### Small code changes

| #   | Change                                                                                                                                                                           | Expected effect                                                                                       | Where                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | Precompress text assets with brotli at build time; `precompressed: true` in `serveWebDistStatic`                                                                                 | Docker without a CDN: −15% first-load JS/CSS, −26% WASM, origin CPU per first load ~58 → 21 ms        | build script, `apps/server/src/static/web.ts`           |
| 2   | `Cache-Control: public, max-age=86400, stale-while-revalidate=604800` for non-hashed public files, plus 304s                                                                     | Returning visitors stop re-downloading up to ~2.6 MB of homepage images per release                   | `web.ts` `onFound`                                      |
| 3   | `headers` for the Vercel frontend and a `_headers` file for Workers: immutable `/assets/*`                                                                                       | Removes ~46 revalidations per repeat load on those targets                                            | `vercel.json`, `tooling/cloudflare/build.mjs`           |
| 4   | Start the pdf.js worker with the preview, not after the first PDF                                                                                                                | Cold PDF-to-visible 0.90 → 0.34 s                                                                     | `features/resume/preview`                               |
| 5   | Stop the second signed-out session check on startup and on hover preloads, keeping the "signing in elsewhere shows on next navigation" contract                                  | ~0.2 s per signed-out load                                                                            | `libs/root-context.ts:23`                               |
| 6   | Dashboard route `loader` prefetching its existing query; start root context earlier (preload hints or inline flags)                                                              | Dashboard warm 1.23 → 0.89 s, cold 2.28 → 1.92 s (both, measured what-if)                             | `routes/dashboard/index.tsx`, `main.tsx`, server shell  |
| 7   | Phosphor icon-font CSS only in the 3 builder components that use it                                                                                                              | −10.9 KB gzip render-blocking CSS on every page                                                       | `packages/ui/src/styles/globals.css:10`                 |
| 8   | Session check with plain `fetch` instead of the Better Auth client in the eager graph                                                                                            | −19.9 KB gzip eager JS                                                                                | `libs/auth/session.ts`                                  |
| 9   | `getRouteApi()` in 16 route components that import their route file back                                                                                                         | −15.4 KB gzip, 15 fewer eager files                                                                   | `routes/**`                                             |
| 10  | Motion `domAnimation` by default, `domMax` only where `layoutId` is used; `DonationToast` loaded when its timer fires; Phosphor `fill` weight only for the ~20 icons that use it | −14 KB, −3–8 KB, −10.4 KB gzip                                                                        | `__root.tsx`, `vite.config.ts`                          |
| 11  | Dashboard: stop importing the builder's `draft.ts` and the tags editor eagerly; builder: defer `node-html-parser`                                                                | −34 KB dashboard, −47 KB builder gzip                                                                 | dashboard and builder features                          |
| 12  | Compress custom-domain resume pages, `/schema.json` and RPC batch responses; cache `/openapi.json`                                                                               | 89 → 16 KB per custom-domain page; 103 → 8 KB; ~3× on RPC batches; 2.18 MB regenerated per request    | `apps/server/src/http`                                  |
| 13  | Sitemap query partial index; count resume views after responding                                                                                                                 | Production sitemaps take 3.1–4.2 s per crawler fetch (393 → 3.3 ms on 1.2M test rows); ~8 ms per view | `packages/db`, `static/seo.ts`, `static/resume-page.ts` |

### Medium

- **Noto fallback fonts on demand.** Fetch the punctuation/CJK fallbacks only when a character is missing from the
  chosen fonts: default first-preview fonts 794 → 286 KB, a Korean first preview 29 → 11.8 MB (the always-added Noto SC
  "safety net" is 17.35 MB). Helps thumbnails, server PDFs and the mobile app too. Risk: a coverage bug prints "?"
  (the existing lost-characters warning makes it visible). `packages/pdf/src/hooks/use-register-fonts.ts`.
- **Public resume page fonts.** Self-hosted WOFF2 subsets of the used characters: 343.6 → 47.7 KB (−86%), Chinese
  14.9 MB → 792 KB, and visitors' IPs stop going to Google. Downscale profile pictures for the page (800 px shown at
  133 px; a 400 px WebP is 13.4 vs 70.8 KB). Switch `no-store` to `private, no-cache` with an ETag; make the render
  cache an LRU of compressed pages; stop the OG card loading every resume font (a Chinese card took 5.7 s, 207 MB).
- **Startup UI on first use.** Load toasts, dialogs, the confirm dialog, tooltips and hotkeys when first needed:
  −62 KB gzip eager (toasts fired before the container mounts must be buffered). Take zod out of eager code:
  −34.6 KB (`zod/mini` alone saves only 6 KB).
- **Homepage CSS.** Split homepage-only CSS (~16 KB gzip) and add metric-matched fallback fonts, which inlining
  critical CSS later needs: once paint gets earlier, font-swap CLS reaches 0.167 on the hero without them.
- **Dashboard thumbnails** download the whole PDF engine (~4.1 MB gzip) and their cache key changes on most deploys;
  re-key them, or render thumbnails on the server.

### Large or later

- Hydrating the prerendered marketing pages instead of replacing them with `createRoot`. Inlining critical CSS on
  those pages cut first paint from ~1.7 s to ~0.4–0.6 s locally, but the re-render pushed LCP to 5–7.6 s; hydration
  (Router SSR utilities, or a Start pilot limited to marketing) has to come first.
- Common-character CJK subsets for the PDF engine (978 KB vs 8.6 MB per weight).
- Redact, only after upstream focuses `autoFocus` controls on mount: restore the build mode from commit `a23bbd068`
  and pass the gate in [redact.md](./redact.md).

### Considered, not worth it

AVIF thumbnails (−25% vs WebP, but needs `<picture>` and decodes slower during the scroll zoom); WebP at the
`/templates/jpg` URL (old mobile builds expect JPEG); WOFF2 for PDF fonts (Forme reads TTF/OTF only); Google's
`text=` font subsetting (sends resume text to Google); zstd (never beat brotli here); `wasm-opt` on Forme (−0.9%);
the modern pdf.js build (−36 KB, breaks older Safari); removing the `framework`/`vendor` chunk groups (+34.5 KB and
113 files without them); native React size tricks (`createRoot` alone vs with `hydrateRoot` differs by 29 B).

## Bugs found along the way

- **Pictures blocked on rx.cv and custom domains.** Uploads send `Cross-Origin-Resource-Policy: same-site`
  (`apps/server/src/static/uploads.ts:56`), so Chromium blocks them on other sites (`ERR_BLOCKED_BY_RESPONSE`).
  Reproduced locally by the auditor; not checked live. Public pictures need `cross-origin`.
- **Vercel: OG cards and resume sitemaps 404.** `/cards/*.png` and `/sitemaps/*.xml` match the file-extension rewrite
  to the static `frontend` service in `vercel.json`. From reading the config; not tested on a deployment.
- The welcome email's logo is an SVG, which Gmail and Outlook do not render.
- Unreferenced: `public/fonts/{fira-sans-condensed-500,ibm-plex-serif-400,ibm-plex-serif-600}.ttf` (613 KB),
  `public/opengraph/logo.svg` and `features.jpg` (recompressed here, not deleted, in case of external links), the
  Phosphor SVG/TTF/WOFF font fallbacks in `dist/assets` (2.9 MB, never fetched), and the `/videos/*-vN` cache rule in
  `web.ts` (no videos exist).

## Decision rule for TanStack Start

Revisit when all of these hold: a concrete need beyond static marketing HTML and Hono's resume pages (many dynamic
public pages, or data-rich views that benefit from server reads); a native-React pilot beats the optimized current
baseline on `/`, an RTL locale, the dashboard, a large resume in the builder and a public resume (p75 FCP/LCP,
interaction readiness, transferred JS and serialized data, server CPU and cold starts); Docker, Vercel Services and
Cloudflare Workers pass runtime gates; hydration, locale, theme, CSP and auth are proven; and the custom prerender and
SEO code is deleted rather than kept beside Start. Keep oRPC, Better Auth, MCP and the mobile API contracts either way;
Start server functions must not become a mobile protocol. Router's own SSR utilities are a smaller path if only the
marketing pages need hydration.

## Not verified

- **No field data.** PageSpeed Insights' keyless quota returned HTTP 429 (`quota_limit_value: 0`) for every request.
  Rerun with an API key before ranking by real-user impact.
- Safari/WebKit (image `srcset` choice, hidden lazy footer image), real devices and Firefox interaction timings.
- Cloudflare zone settings were inferred from response headers; the zone configuration itself was not inspected.
- Vercel and Workers behaviour came from documentation and the installed preset source, not a live deployment.
- Builder and mobile picker image bytes come from code reading plus the browser cache model, not a captured session.
