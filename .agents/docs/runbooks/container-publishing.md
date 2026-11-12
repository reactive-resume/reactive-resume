# Container publishing

The repository is `reactive-resume/reactive-resume`. Docker Hub remains
`docker.io/amruthpillai/reactive-resume`; GHCR follows the repository as
`ghcr.io/reactive-resume/reactive-resume`. Do not derive Docker Hub's image name from `github.repository`.

## Builds and release safety

`.github/workflows/docker-publish.yml` builds AMD64 and ARM64 on matching native runners.
Workflows that check `USE_BLACKSMITH` (CI, autofix, Docker publishing, issue maintenance) run on GitHub-hosted runners
(`ubuntu-latest`, `ubuntu-24.04-arm`) by default, so forks work without setup. `mobile-release.yml` always
runs on Blacksmith Linux and macOS runners. Setting `USE_BLACKSMITH=true` switches
the other workflows' jobs to Blacksmith runners (32 vCPU for build/test jobs, 2 vCPU for lightweight jobs) and
swaps in `useblacksmith/checkout`, `useblacksmith/setup-docker-builder`, and
`useblacksmith/build-push-action`. Because `uses:` cannot be an expression, each swapped
action is a pair of steps gated on the variable; keep both halves in sync when editing.

On GitHub-hosted runners, Docker Buildx shares its local cache between steps within a job and
no cache is persisted between workflow runs. On Blacksmith, the builder persists layers and the
Dockerfile's pnpm cache mounts between runs, keyed per architecture (`Dockerfile-amd64`,
`Dockerfile-arm64`).

| Trigger                                         | Action                     | Published aliases                                      | Production deployment                              |
| ----------------------------------------------- | -------------------------- | ------------------------------------------------------ | -------------------------------------------------- |
| Push to `main`                                  | Build AMD64 and ARM64      | `sha-<full-commit>`, `nightly`, timestamped nightly    | No                                                 |
| Manual dispatch, default `release=false`        | Build AMD64 and ARM64      | `sha-<full-commit>`, `canary-<run-id>-<attempt>`       | No                                                 |
| Push of a stable `v*` tag                       | Promote existing SHA image | `latest`, version/major/minor (`v6.0.0`, `v6.0`, `v6`) | When configured: SSH redeploy and Cloudflare purge |
| Push of a prerelease `v*` tag                   | Promote existing SHA image | Prerelease version only (for example, `v6.0.0-rc.1`)   | No                                                 |
| Manual dispatch, `release=true`, branch         | Promote existing SHA image | `latest`, version/major/minor from `package.json`      | When configured: SSH redeploy and Cloudflare purge |
| Manual dispatch, `release=true`, stable tag     | Promote existing SHA image | `latest`, version/major/minor (`v6.0.0`, `v6.0`, `v6`) | When configured: SSH redeploy and Cloudflare purge |
| Manual dispatch, `release=true`, prerelease tag | Promote existing SHA image | Prerelease version only                                | No                                                 |

Each main push builds its own full commit-SHA image; newer pushes do not cancel earlier
builds. An older build still publishes its SHA and timestamped nightly aliases, but only
the current main HEAD updates the moving `nightly` alias. Architecture-specific build
outputs use `sha-<full-commit>-amd64` and `sha-<full-commit>-arm64`.

### Explicit product releases

A push to `main` publishes container images only. It never builds mobile binaries, creates Git tags, or creates
GitHub Releases; mobile store builds come from `mobile-release.yml` (see [mobile releases](./mobile-releases.md)).
Product GitHub Releases and `v*` tags are created only by an explicit versioned release operation. Docker promotion
consumes an existing tag or commit; it does not create either.

Forme's manually published, checksum-pinned binary assets remain available at their
existing URLs. Moving those rare artifacts to dedicated storage is deferred; never
remove an asset still referenced by `packages/forme-native/scripts/prebuilt.json`.

### Stable promotions

Before moving any container aliases or deploying production, the latest `ci.yml`
CI run from a `main` push must have completed successfully for the exact full commit
SHA being promoted. Missing, failed, cancelled, or pending CI blocks promotion;
PR checks and manual smoke-only runs cannot authorize it. If historical CI was
removed, that commit is no longer eligible for this promotion path. This check runs
before registry mutations and does not rebuild the source image.

Release tags must be `vMAJOR.MINOR.PATCH`, optionally with a prerelease suffix, and match
`package.json` at the tagged commit. Promotion resolves that commit's GHCR
`sha-<full-commit>` image, validates both architectures, and copies the complete image index
within GHCR. It adds no annotations and checks that each resulting alias has the source digest.
Embedded SBOM/provenance manifests and existing digest-addressed signatures stay intact; the
workflow also signs the promoted digest.

Promotion waits up to 35 minutes for a running main build to publish the source images (`tooling/docker/promote.sh`), then fails if they are still missing.
Missing images or incomplete indexes fail before aliases move; promotion never falls back to
a rebuild. For an unpublished commit on a ref containing this workflow version, run a
manual `release=false` build at that ref first, then rerun promotion. Historical refs with
older workflow files still run their original workflow; their short SHA tags are not promotion
sources. Keep full SHA images in registry retention policies so commits remain promotable.

Manual `release=true` on main or another branch promotes the branch head to `latest` and to
the full/minor/major aliases of its `package.json` version (a prerelease version updates only
its own alias and skips production integrations). Use it to republish a release with a fix
that landed after its Git tag, without rebuilding:

```bash
gh workflow run docker-publish.yml --repo reactive-resume/reactive-resume --ref main -f release=true
```

To re-promote an existing stable release, select its Git tag. This updates `latest` and
that release's full/minor/major semver aliases. The tag must match the built `package.json`
version. Prerelease tags update only their prerelease alias and skip production integrations.

```bash
gh workflow run docker-publish.yml --repo reactive-resume/reactive-resume --ref v6.0.1 -f release=true
```

SSH redeployment requires `SSH_KEY`, `SSH_HOST`, and `SSH_USER`; Cloudflare purging requires
`CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN`. Each integration is skipped if any required
secret is missing. Dispatch does not create a Git tag, GitHub release, or version bump.

Manual canaries build, publish, merge, and sign images in enabled registries without
running production integrations:

```bash
gh workflow run docker-publish.yml --repo reactive-resume/reactive-resume --ref main -f release=false
```

Published images retain SBOMs, maximum provenance, and Cosign signatures. GHCR always uses
the destination repository's `GITHUB_TOKEN` with `packages: write`. GHCR is the primary
registry: builds, indexes, promotion, signing, anonymous-pull verification, and production
deployment depend on it alone. Docker Hub is a best-effort mirror, enabled only when both
`DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets are present. After GHCR is published and
verified, the workflow copies the GHCR index to Docker Hub under the same tags (same digest)
and signs it there; Docker Hub login or mirror failures show as failed steps but never fail
the run. Rerun the workflow to retry a missed mirror. Image references are normalized to
lowercase. New GHCR packages need public visibility, repository linkage,
and Actions access before consumers can pull anonymously.

## Verification and historical images

The September 12, 2026 rename rebuild used commit `f89acb436865cf536fffed2b23d4d72a7ecff0db`
in [workflow run 34685606073](https://github.com/reactive-resume/reactive-resume/actions/runs/34685606073).
Both registries' `latest`, `v5`, `v5.3`, and `v5.3.0` aliases were verified at:

```text
sha256:7c7b7824785d1386fa6e0e6132c1abe43e3c281f90dbf3b1474b60bffb64d89e
```

The workflow built both architectures, generated SBOMs and provenance, signed the images,
passed anonymous AMD64/ARM64 pulls from both registries, redeployed production, and purged
Cloudflare. The live health endpoint reported healthy version `5.3.0`, and the homepage
served the new repository URL. No new GitHub release or version bump was made.

Check the manifest for `linux/amd64` and `linux/arm64`, then pull both using an empty
Docker configuration with explicit empty registry credentials to prove anonymous access
(a completely empty directory can still discover a system credential helper):

```bash
docker buildx imagetools inspect ghcr.io/reactive-resume/reactive-resume:v5.3.0
registry_config=$(mktemp -d)
printf '%s\n' '{"auths":{"ghcr.io":{}}}' > "$registry_config/config.json"
docker --config "$registry_config" pull --platform linux/amd64 ghcr.io/reactive-resume/reactive-resume:v5.3.0
docker --config "$registry_config" pull --platform linux/arm64 ghcr.io/reactive-resume/reactive-resume:v5.3.0
rm -r "$registry_config"
```

On September 11, 2026, `latest`, `v5`, `v5.3`, and `v5.3.0` were copied to the then-current
public GHCR package, `ghcr.io/reactive-resume/app`. Both architectures were pulled anonymously; the original Cosign signature,
SBOMs, provenance, and image digest were verified. The signed canary
[`canary-34582818410-1`](https://github.com/reactive-resume/reactive-resume/actions/runs/34582818410)
also passed on both registries without deploying production.

The original v5.3.0 at the previous GHCR address has digest
`sha256:c487ec5edcfe054bcb312fcd498f868e56f274756d0046b01c83f210855017ab`.
Copy complete image indexes rather than rebuilding historical releases or using a
single-platform pull/tag/push. Preserve embedded attestation manifests and copy attached
signatures separately. Verify the resulting digest before moving aliases. Retain the old
GHCR packages for historical pulls; future updates publish under the new namespace.
The repository rename does not rename registry packages. Rebuilt images use the new
repository source label and signing identity; historical digests and signatures do not change.
Release aliases are mutable: pin the original digest above if you need the pre-rename artifact.

New signatures identify
`https://github.com/reactive-resume/reactive-resume/.github/workflows/docker-publish.yml@<ref>`.
Images signed before the workflow rename retain
`https://github.com/reactive-resume/reactive-resume/.github/workflows/docker-build.yml@<ref>`.
Use the workflow identity from the image's signing record when verifying older images.
Signatures and image source labels from before the repository rename retain the old repository identity. Verify
historical v5.3.0 with its original workflow identity, even at its new registry address:

```bash
cosign verify \
  --certificate-identity https://github.com/amruthpillai/reactive-resume/.github/workflows/docker-build.yml@refs/heads/main \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  ghcr.io/reactive-resume/app@sha256:c487ec5edcfe054bcb312fcd498f868e56f274756d0046b01c83f210855017ab
```

After the rename, GitHub reports `use_immutable_subject: true` and subject prefix
`repo:reactive-resume@245328954/reactive-resume@249995750`. Inspect actual claims when updating external
OIDC trust policies; the repository URL alone does not describe the subject.

## Independent migration items

- GitHub Sponsors stays `AmruthPillai`; Open Collective stays `reactive-resume`.
- `server.json` keeps MCP registry identifier `io.github.amruthpillai/reactive-resume`.
  Changing that identifier creates a separate registry identity and requires its own migration.
- The old GitHub repository redirects to the new repository. Never recreate the old repository.
- The old Pages address `https://amruthpillai.github.io/reactive-resume/` returned 404 on
  September 11, 2026. GitHub now reports `https://reactive-resume.github.io/reactive-resume/`; repository
  redirects do not redirect Pages traffic. No active repository references use the old Pages URL.
- Confirm documentation hosting, Crowdin, Docker Hub source metadata, sponsorship access
  rewards, and any external OIDC policies in their owning accounts. Repository transfer alone
  does not verify those integrations.

Track availability and supported copied tags in [migration issue #3503](https://github.com/reactive-resume/reactive-resume/issues/3503).
No database reset, volume deletion, or resume-data migration is required.

References: [GitHub package permissions](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages),
[Cosign verification](https://docs.sigstore.dev/cosign/verifying/verify/).
