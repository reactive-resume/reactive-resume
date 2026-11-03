# E2E Tests

Reactive Resume uses Playwright for PR-gated browser coverage of deterministic core flows.

## Local setup

Install Poppler (`brew install poppler` on macOS or `sudo apt-get install poppler-utils` on Debian/Ubuntu). The browser PDF download test uses `pdftotext` to verify logical Unicode text, including `/ActualText` spans.

Start PostgreSQL and install Chromium once:

`docker compose -f compose.dev.yml up -d postgres`

`pnpm exec playwright install chromium`

Then build the app and run the suite:

`pnpm test:e2e:local --build`

`pnpm test:e2e:local` runs the browser job's setup from CI against this checkout only. It creates and migrates a
database named after the checkout directory (`rr_<checkout>_e2e`), stores uploads in a matching directory under the
system temporary folder, picks a free port, and sets the same fixed secrets and flags as CI, including
`FLAG_ALLOW_UNSAFE_AI_BASE_URL=true` for the assistant specs. Separate worktrees can run it at the same time without
sharing a server or data.

- `--build` runs `pnpm build` first. Without it, the command uses the existing `apps/server/dist` build and stops if
  there isn't one. Rebuild after changing application code.
- Every other argument goes to `playwright test`, for example
  `pnpm test:e2e:local tests/e2e/specs/auth.spec.ts --workers=1`.
- `pnpm test:db down` drops the checkout's test databases, including the e2e database.
- Set `TEST_DB_ADMIN_URL` if your local PostgreSQL isn't at `postgresql://postgres:postgres@localhost:5432/postgres`.

To run Playwright yourself instead, export the variables from the CI browser job in `.github/workflows/ci.yml`
against a disposable database, run `pnpm db:migrate` and `pnpm build`, then `pnpm test:e2e`. Playwright reuses any
server already listening on `PORT`, so choose a port no other checkout is using.

CI runs browser tests independently from unit tests, with four Playwright workers on 32-vCPU Blacksmith runners
and one on GitHub runners. Each test owns its account and browser context; provider fixtures use ephemeral ports.
To compare locally, append `--workers=1` or `--workers=4` to the test command against the same disposable database
and production build. The runner still uses zero retries, so parallelism cannot hide a failed test.

## Coverage

- Email/password sign-up, sign-out and sign-in through the UI.
- Guest login, and a guest's resume carried over when they create an account. Skips without `FLAG_ENABLE_GUEST_LOGIN=true`.
- Builder section editing, with autosave across reloads and a draft kept when saving during navigation fails.
- JSON export/import through the New dialog, including an older file whose resume still carries a cover letter.
- Public sharing: an anonymous visitor's PDF download and statistics, a renamed address that keeps redirecting, and
  a password-protected link.
- OAuth consent for MCP clients: deny, allow with PKCE, and the access token's audience at `/mcp`.
- The assistant, against a scripted OpenAI-compatible provider (`fixtures/ai-stub.ts`). It needs `FLAG_ALLOW_UNSAFE_AI_BASE_URL=true` so the server may call the stub on 127.0.0.1, and skips without it.

Visual regression, PDF/DOCX rasterization parity, thumbnail resolution, and import-fixture reproduction are
intentionally outside the PR gate to keep it fast.
