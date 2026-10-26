# Web pages are rendered on the server

Status: accepted (2026-10-26)

The app is a client-rendered SPA, but a resume's **Web page** is built as complete HTML on the server for each request (cached until the resume or its Share settings change) and ships almost no JavaScript. Search engines read it without running scripts, recruiters see it immediately, and custom domains only ever serve HTML and CSS: no app shell, API routes or sign-in paths on hosts the app doesn't own. The builder's Share preview renders the same output in the browser, so preview and published page can't drift.

## Consequences

- This is the server's first request-time page render; until now only marketing pages were prerendered at build time.
- Code that produces a web page must run on the server: no browser-only APIs in templates or their web conversion.
- The public resume route no longer depends on `/api/rpc` being crawlable, so `robots.txt` keeps blocking it.
