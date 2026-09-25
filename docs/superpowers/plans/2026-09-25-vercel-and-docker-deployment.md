# Vercel one-click deployment with Docker compatibility

Status: implemented on `vercel-docker-deployment`; final clean Deploy Button wizard validation pending.

## Outcome and deployment contract

Ship one application with two supported deployment targets. Reuse the Hono app, API contracts, database schema, authentication, and renderers. Keep the current Docker image, port, volume layout, environment variables, startup migrations, and optional-service behavior compatible.

| Concern | Vercel default | Docker standalone |
| --- | --- | --- |
| Compute | Node.js 24 Functions, Fluid compute | Existing Node.js server |
| Frontend | Vite assets on CDN; dynamic HTML through Hono | Existing disk assets and Hono HTML handling |
| Database | Neon through Vercel Marketplace | Existing PostgreSQL connection |
| Files | Private Vercel Blob store, application-authorized delivery | Existing local disk or S3 backend |
| Redis | Upstash through Vercel Marketplace, Redis TCP/TLS endpoint | Existing optional Redis service |
| Secrets | Persisted project environment variables | Existing environment variables |
| Migrations | Non-cached deployment preparation | Existing startup behavior |

User-approved revision: target Vercel Hobby. Both Docker and Vercel use a four-minute active agent run timeout, reserving one minute for setup/final persistence within Vercel's five-minute Function budget. This limit applies to one question/run, never the conversation; every follow-up receives a fresh timer. Normal answers return immediately. [Vercel limits](https://vercel.com/docs/functions/limitations).

“One-click” means the standard Deploy with Vercel wizard: clone/import, select a team, approve resource provisioning, supply persistent application secrets, then deploy without editing source or running migrations manually. It does not mean bypassing account creation, provider billing consent, or SMTP/OAuth/AI-provider credentials. The button supports required integrations/products and user-entered environment variables. [Deploy Button](https://vercel.com/docs/deploy-button), [environment variables](https://vercel.com/docs/deploy-button/environment-variables).

## 1. Prove the deployment and provisioning path first

Before broad implementation, validate a minimal deployment using the actual workspace build and current Vercel configuration schema.

- Use one Vercel project rooted at the repository, with a thin Node function entrypoint delegating to the shared Hono app and static output from `apps/web/dist`. Prefer standard configuration; use Build Output API only if needed for the existing build artifacts.
- Confirm how the Deploy Button requests Neon, Upstash, and a private Blob store. Record exact product identifiers and injected environment variable names from a clean project creation flow; do not guess them or confuse REST credentials with `REDIS_URL`.
- Prove Blob is provisioned and attached before the first build. If standard product configuration cannot request a private Blob store, resolve that provisioning gap before advertising one-click support. A manual “create storage and redeploy” step is not the acceptance target.
- Require `AUTH_SECRET` and `ENCRYPTION_SECRET` through the deployment form, with instructions for generating independent random values. Never generate ephemeral secrets at build time or cold start; never put secret defaults in the button URL.
- Validate initial production-domain discovery and same-region placement of compute, database, Blob, and Redis where available.
- Measure the server Function bundle, including `sharp`, `bcrypt`, React PDF, and runtime assets. Stay within standard supported limits rather than depending on beta large Functions.

Exit: a documented, reproducible configuration that deploys the shared server, serves a page and health route, connects provisioned services, and survives redeployment with unchanged secrets. Provisioning validation is an explicit implementation gate, not a claim already verified by this plan.

## 2. Separate platform startup from shared request handling

Primary owners: `apps/server/src/index.ts`, `apps/server/src/http/app.ts`, `apps/server/src/static/*`, `apps/server/tsdown.config.ts`, new Vercel entrypoint/configuration, and `tooling/` deployment scripts.

- Keep Docker's `main()` and `serve()` entrypoint. Add a Vercel entrypoint that exports a request handler without listening on a port or running Docker startup checks.
- Reuse `createApp()`; add only the small hooks needed for asset delivery, trusted client identity, and background task lifetime. Keep Vercel SDK imports at the server adapter boundary.
- Build both apps using the pinned workspace package manager and existing build tools. Include emitted prompt Markdown, the HTML shell, necessary renderer assets, package import mappings, and version substitution in the Function bundle.
- Route `/api/*`, `/mcp`, `/.well-known/*`, uploads, schema, SEO endpoints, and dynamic page requests correctly. Preserve legacy upload URLs.
- Serve assets from CDN while keeping existing root/public-resume metadata injection, canonical URLs, `ROOT_RESUME_ID`, noindex rules, security headers, HEAD handling, and 404 behavior. Do not replace the current server behavior with a blanket SPA rewrite.
- Confirm missing asset requests return 404 rather than HTML, and authenticated responses and private assets cannot acquire public CDN caching accidentally.

Vercel's native Hono integration expects an exported app and serves static files through its CDN; its documented `serveStatic()` behavior differs from Docker. Validate the selected integration against this build. [Hono on Vercel](https://vercel.com/docs/frameworks/backend/hono).

Exit: the same route smoke suite passes against built Docker and Vercel output, including deep links and public metadata.

## 3. Make configuration, database preparation, and authentication portable

Primary owners: `packages/env`, `packages/db`, `packages/auth`, `apps/server/src/startup`, root `turbo.json`, `.env.example`.

- Normalize verified Marketplace variable names into the existing database/Redis settings. Explicit existing settings take precedence. Add an optional explicit storage backend selector while preserving existing S3-then-local defaults when it is absent. Vercel deployment selects Blob and rejects accidental local persistence.
- Resolve `APP_URL` from an explicit setting first, then trusted Vercel deployment metadata. Use the stable production hostname in production and the isolated deployment hostname in preview. Do not derive trusted origins from arbitrary request headers or trust all `*.vercel.app` domains.
- Add every required new environment variable to env validation and Turborepo passthrough configuration, including Blob authentication and platform metadata used at runtime.
- Keep Drizzle and `pg`. Use a pooled Neon URL for runtime, a suitable migration connection for deployment, bounded pools, and platform-supported idle connection cleanup. No database driver rewrite is required by default.
- Extract reusable migration/schema verification logic. Docker continues invoking it at startup. Vercel invokes it in a non-cached deployment-preparation command after build verification and before successful deployment publication.
- Serialize concurrent migrations with a database lock using an appropriate connection. Failed migrations fail deployment. Do not run migrations from request handlers, and never target production data from an untrusted preview build.
- Use isolated preview database resources and environment-specific Redis/storage namespaces. Ensure production rollout uses backward-compatible migrations; rolling code back does not roll schema back.
- Preserve migration-before-auth-seeding ordering. Make resource seeding idempotent under concurrent Function initialization and ensure required initialization is awaited.
- Fix MCP OAuth key verification: `packages/auth/src/config.ts` currently defaults JWKS lookup to localhost. Preserve Docker's internal URL override and choose a verified in-process or canonical HTTPS lookup for Vercel, accounting for deployment protection. Verify issuer, audiences, key rotation, and OAuth discovery.
- Preserve email/password, social/custom OAuth, passkeys, two-factor authentication, API keys, and feature flags. SMTP and OAuth credentials remain user-supplied optional configuration; document email-dependent behavior without SMTP.

Exit: fresh install, repeat deployment, custom domain, preview isolation, authentication, and MCP OAuth work; existing Docker environment files need no changes.

## 4. Add Blob storage and preserve existing file limits

Primary owners: `packages/api/src/features/storage`, `packages/api/src/features/agent`, server upload/download handlers, and existing web upload callers.

- Implement Blob behind the current `StorageService` contract. Preserve stable logical keys, list/read/write/delete semantics, content types, health reporting, and prefix deletion. Handle provider pagination.
- Prefer one private Blob store. Existing application routes decide which objects are public and which require authentication, matching current S3 proxy behavior. Never expose agent attachments through the public uploads handler.
- Add authenticated direct-upload authorization and finalize operations for Blob. Server chooses a user-scoped staging key, validates ownership, size/type limits and quotas, and verifies the stored object before committing application metadata. Finalization must be idempotent and reject foreign objects or replay that bypasses quotas.
- Preserve 10 MB general uploads and 25 MB agent attachments. Route bytes directly to Blob, then process server-side from storage. Preserve image resizing/JPEG conversion and `FLAG_DISABLE_IMAGE_PROCESSING`; do not publish raw staged images as final assets.
- Update every affected caller, including pictures, cover-letter files, and agent attachments, to negotiate supported upload capability. Retain existing Docker upload endpoints and API compatibility; document the direct-upload API for clients on Vercel. Raw request bodies above Vercel's limit cannot keep the same transport.
- Audit other large payloads such as resume imports, encoded data, PDFs, DOCX, and stored-file downloads. Use authenticated signed delivery or verified streaming where required; preserve download filenames, public/password-protected access, and application size limits.
- Clean up expired staging objects and failed uploads with a bounded scheduled task if lazy cleanup cannot cover abandoned uploads. Do not expose a public maintenance endpoint.
- Keep local and S3 backends working without Vercel credentials. Retain the existing restriction that private agent attachments require a capable object backend; this project does not currently support them on local disk.

Blob supports private storage and authorized direct uploads. Direct uploads avoid the Function request-body limit. [Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk), [client uploads](https://vercel.com/docs/vercel-blob/client-upload).

Exit: maximum-size uploads/downloads work on Vercel; private access and image processing match Docker; existing Docker URLs and files remain usable.

## 5. Make agent runs and limits safe across Function instances

Primary owners: agent `streams.ts`, `service.ts`, `runs.ts`, request context, rate-limit middleware, and server adapters.

- Supply Vercel `waitUntil` through a narrow lifecycle hook for the complete producer/finalization promise. Retain normal Node behavior for Docker. Avoid relying on untracked promises after a request disconnects.
- Use the agreed shared 240-second agent timeout and configure Function duration to 300 seconds. Bound cleanup/finalization and prove it completes within the remaining budget. `waitUntil` does not remove duration limits. [Functions API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
- Retain Redis resumable streams through `ioredis`; connect Upstash via TLS Redis credentials rather than replacing the client with a REST KV SDK.
- Add cross-instance cancellation with durable cancellation state plus prompt notification/checking. Abort local controllers when signaled. Keep the active database claim until terminal persistence completes; a stop request on another instance must not release a still-running writer prematurely.
- Cover stop, archive, deletion, reconnect, tool approval, timeout, and interrupted-run recovery. Preserve committed edits and existing stale-run recovery; do not promise execution survives a terminated Function.
- Namespace Redis keys by application/environment. Close/unsubscribe request-scoped resources and bound connection use under concurrency.
- Use shared counters for existing API/auth/public-PDF limits when Redis is configured. Preserve current single-process fallback when Docker has no Redis. Audit existing auth limiter storage before changing it.
- Resolve trusted client identity in the deployment adapter using platform-authenticated metadata; preserve Docker proxy behavior. Test spoofed forwarding headers.
- Move view deduplication to the shared store where cross-instance duplication changes existing statistics; ordinary performance caches can remain local.

Exit: two server instances can start, resume, and stop the same run safely; disconnect/reconnect works on deployed Vercel; limits hold across instances; Docker without optional Redis still supports its existing core flows.

## 6. Finish the deployment experience and documentation

- Add the verified Deploy with Vercel button to README and a Vercel self-hosting guide to docs navigation.
- Make the first successful deployment usable for signup, resume editing, sharing, export, and provider configuration. Agent becomes usable once the user saves AI-provider credentials.
- Describe required Vercel plan, provider charges/quotas without hardcoded prices, optional SMTP/OAuth setup, custom domains, backups, deployment updates, preview isolation, and code/schema rollback behavior.
- Document actual environment names, precedence, credentials, and generated-domain behavior. Keep Docker/Compose guides and current commands valid; update stale architecture notes describing the SPA as TanStack Start.
- Extend health reporting for Blob and configured Redis without leaking credentials or exposing storage URLs unnecessarily.
- Do not add a new deployment platform abstraction, queue/workflow engine, cross-provider data migration utility, or second frontend. Add further infrastructure only if the deployment proof demonstrates a concrete need.

## Verification and release gates

Reuse existing Vitest and Playwright infrastructure; add tests at changed trust and lifecycle boundaries rather than duplicating whole suites.

| Environment | Required proof |
| --- | --- |
| Docker + PostgreSQL + local volume | Core flows, existing env file, volume persistence across restart, startup migrations, no Blob/Redis requirement |
| Docker + PostgreSQL + S3 + Redis | Existing uploads, private attachments, image processing, agent lifecycle, exports, MCP |
| Two Node instances + shared Redis/DB | Cancellation/claim ordering, stream reconnection, shared rate limits, tenant isolation |
| Vercel + Neon + private Blob + Upstash | Fresh Deploy Button flow, maximum-size files, real streaming, cold starts, five-minute per-run budget, OAuth/MCP, redeployment |
| Isolated Vercel preview | Separate data/namespaces, correct origin, no production migrations or secret leakage |

Shared smoke coverage: signup/login, configured recovery/verification email and OAuth, passkeys/2FA where configured, CRUD/import/export, PDF/DOCX and representative fonts/templates, cover letters, ATS checker, public and password-protected resumes, pictures/files, settings/provider encryption, agent tool approvals/revert/reconnect/stop, API keys, OpenAPI/MCP, SEO/status codes, and configured feature flags.

Add focused regression checks for Blob authorization/finalization, private reads, concurrent migration initialization, env precedence, forged proxy headers, and two-instance agent cancellation. Test payloads above 4.5 MB through the actual deployed transport, not only localhost.

Run relevant package tests/typechecks during each change, then repository build, boundary checks, existing CI suites, and Docker image smoke tests for release. Use non-mutating Biome inspection unless intentional formatting edits are needed. Build Vercel artifacts in CI and run credentialed deployment smoke tests in a trusted workflow; fork builds must not receive deployment secrets.

Run the Deploy Button from a clean account/project with no pre-created services as the final manual release gate. Record necessary wizard actions and prove a second deployment retains sessions, encrypted AI credentials, files, and data. Do not label one-click support complete while resource provisioning or first-run migrations still require undocumented steps.

## Suggested implementation sequence

1. Deployment/provisioning proof; settle exact platform configuration and product identifiers.
2. Shared bootstrap, environment/database/auth changes, and Vercel routing/build output.
3. Blob backend and direct upload/download support.
4. Distributed agent lifecycle and shared limits.
5. Deploy Button, documentation, CI, and full Docker/Vercel parity validation.

Each change remains backward-compatible with Docker. Publish the deployment button only after all release gates pass. No existing data is moved automatically, and no production resources are provisioned as part of writing this plan.

## Execution evidence (2026-09-26)

- Branch pushed with shared Docker/Vercel implementation, private Blob staging, distributed cancellation/rate limits, deployment preparation, and CI artifact checks.
- Live Hobby project: `https://reactive-resume-compat.vercel.app`; Neon, private Blob, and Upstash provisioned on free plans, with Upstash automatic upgrades disabled.
- Verified signup/session authentication, resume creation/read, public PDF rendering, maximum 10 MiB general upload/download, maximum 25 MiB private attachment, OAuth PKCE token exchange, authenticated OpenAPI and MCP initialization, and deployed agent stream/disconnect/resume/stop.
- Two independent local Node processes verified Redis stream resume, remote cancellation, persisted partial answer, and claim release.
- Docker local disk and Docker S3 + Redis verified signup, resume CRUD, public PDF, and 10 MiB upload/download. S3 + Redis additionally verified 25 MiB private attachments.
- Vercel artifact builds without cloud credentials against disposable PostgreSQL; Function footprint approximately 97 MiB, Node.js 24, maxDuration 300. Dynamic PDFKit font assets explicitly included after live runtime checks exposed missing trace dependencies.
- Repository typechecks and workspace boundaries pass. Full direct Vitest sweep plus the native-ESM subprocess rerun passes. The normal pnpm test shim reproduces two error-message matcher failures on unchanged baseline (`mcp/resources`, `tooling/semantic-css`); both pass when invoking Vitest directly.
- Auth initializes after migrations/in the active request; failed context initialization is discarded, and concurrent resource-seeding uniqueness conflicts are retried without replaying requests.
- Existing per-model-step timeout remains two minutes; overall multi-step run budget is four minutes, within the five-minute host limit.
- Live multi-step timeout completed in 241 seconds, streamed and persisted the timeout message, and released the active run claim. Existing sessions and encrypted provider credentials remained usable across redeployments.

Remaining manual release gates: fresh Deploy Button clone/provision/build in a personal GitHub scope; isolated live preview deployment; optional external SMTP/social-provider/passkey setup appropriate to the installation. The main branch is not merged and no release image has been published.
