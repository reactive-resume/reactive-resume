# Both app domains serve the public pages

Status: accepted (2026-10-26)

Reactive Resume answers on `APP_URL` (`rxresu.me`) and an optional alias, `APP_ALIAS_URL` (`rx.cv`). Every public page works on both without a redirect: resume web pages, the short link `/<username>`, the home page and marketing pages, and the API they call. A link that works on one domain works on the other, so people never meet "works here but not there". Share shows and copies the alias, the shorter address.

Sign-in and the editor (`/auth`, `/dashboard`, `/builder`, `/agent`) live on `APP_URL` only. On the alias, the server answers them with a 301 and the web app does the same for links followed inside it. Login cookies, passkeys and social sign-in callbacks belong to one domain.

## Considered options

- Alias redirects everything except `/<username>`: one address per page, but `rxresu.me/<username>` and `rx.cv/<username>/<slug>` would behave differently.
- Alias as the primary domain with 308s from `rxresu.me`: backlinks survive a 308, but `.cv` is a country-code domain search engines don't treat as generic, while `.me` is.
- Full app on both domains: two sets of login cookies and passkey relying parties.

## Consequences

- Canonical addresses always use `APP_URL`, so search engines index one copy of each page.
- The alias host must point at the same server; no data or settings are per domain.
- Custom domains are separate: they show only the owner's primary resume.
