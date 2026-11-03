# RX-78: discovery coverage baseline and direct ATS feed decision

Measured November 1, 2026 against `main` at `6a595ebf2`. Linear: RX-78 (plan item APP-09).

## Decision

**No-go on direct employer ATS feed adapters.** The search provider found the exact open posting for most targeted queries, and every applicant-tracking-system posting it returned was still open. The largest measured loss is not search coverage. It is the posting check in `packages/api/src/features/applications/posting.ts`, which refuses many employer-hosted copies of postings that search did find. Fixing that check is cheaper than a feed adapter and stays inside the existing posting owner.

Revisit feed adapters only if a later baseline shows a coverage or freshness deficit that the posting check cannot explain.

## What was measured

- **Ground truth:** public job-board APIs for Greenhouse (`boards-api.greenhouse.io`), Lever (`api.lever.co`) and Ashby (`api.ashbyhq.com`). For each company, the open postings were sorted by ID and the postings at one third and two thirds were taken. That gave 26 postings across 14 companies (Greenhouse: GitLab, Airbnb, Stripe, Figma, Cloudflare, Databricks; Lever: Spotify, Palantir, Zoox; Ashby: Ramp, Notion, Linear, Supabase). Vercel and Deel had fewer than three open postings and were skipped.
- **Search:** Firecrawl search, one of the supported web connections, 10 results per query. Queries use the same suffix as `searchJobPostings`, which appends `job posting` to the user's text:
  - **Targeted:** `{company} {title} job posting`, as when a user looks for a role they already know about.
  - **Discovery:** `{title} {first listed location} job posting`, with no company name, as in a scheduled discovery search.
- **Exact hit:** a result address carries the posting's ID (or, for Spotify's own site, the title slug).
- **Accepted:** the exact hit matches the `POSTING_URLS` list in `posting.ts`, excluding LinkedIn. Pages outside that list are accepted only when they carry exactly one JobPosting record.
- **Freshness:** each Greenhouse, Lever or Ashby posting address returned by any query was checked against the same public API.

## Results

| Query     | Completed | Exact posting found | Exact hit on a recognized posting address | LinkedIn copy found |
| --------- | --------: | ------------------: | ----------------------------------------: | ------------------: |
| Targeted  |        26 |            21 (81%) |                                  13 (50%) |            19 (73%) |
| Discovery |        25 |            12 (48%) |                                   8 (32%) |            10 (40%) |

One discovery query hit the provider's rate limit after retries and is excluded.

- **Freshness:** 22 of 22 distinct Greenhouse, Lever and Ashby posting addresses returned across all queries were still open. No stale posting was returned.
- **Found but refused:** 8 targeted exact hits were on employer careers sites (Airbnb, Stripe, Databricks, Spotify, Linear) rather than the tracking system's own address. In fetched page HTML, only Stripe carried a JobPosting record. Airbnb, Databricks, Linear and Spotify did not, so `readOpenPosting` would treat those pages as not being a single posting. Several of those addresses still carry the tracking system's ID: Databricks puts the Greenhouse ID at the end of the path, Linear puts the Ashby posting UUID in `linear.app/careers/{uuid}`.
- **Not found:** 5 targeted queries found no copy of the posting: Cloudflare (Mumbai account executive), Databricks (Melbourne solutions architect), both Palantir postings (published 2021 and 2025), and Ramp (commercial account executive manager). Discovery queries without a company name mostly returned board search pages, which the existing listing filter already drops.

## Cost a feed adapter would add

Each adapter needs employer discovery (which board slug belongs to which employer), normalization across three or more payload shapes, duplicate handling against search results and LinkedIn copies, closed-posting detection, rate limits, and ongoing maintenance when an API changes. It would also have to stay behind the existing web-access and posting boundaries and work the same on web and mobile. The baseline above does not show a gap large enough to justify that.

## Recommended follow-up (not started)

Within `posting.ts`, accept an employer-hosted page as one posting when its address carries a recognizable tracking-system ID, or confirm it by reading that tracking system's public posting. This would have turned up to 8 of the 21 targeted exact hits from refused into accepted in this sample. It needs no new provider, schema or user-facing flow.

## Limits

- One search provider. Exa, Tavily and SearXNG were not measured because no credentials or instance were available in this environment.
- 26 postings, 14 companies, English titles, mostly US and European locations, measured on one day. Treat percentages as a baseline to repeat, not as release thresholds.
- JobPosting detection used the raw HTML returned to a plain request. A provider that renders JavaScript may see records that this check missed.
- No account data, credentials or real applications were used.

## Reproducing

1. Fetch each company's open postings from the public board API and take the postings at one third and two thirds of the ID-sorted list.
2. Run both query forms through the web connection's search with 10 results.
3. Score exact hits and recognized addresses with the `POSTING_URLS` patterns from `posting.ts`.
4. Check every returned Greenhouse, Lever and Ashby address against the board API.
