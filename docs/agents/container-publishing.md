# Container publishing

The repository is `reactive-resume/reactive-resume`. Docker Hub remains
`docker.io/amruthpillai/reactive-resume`; GHCR follows the repository as
`ghcr.io/reactive-resume/reactive-resume`. Do not derive Docker Hub's image name from `github.repository`.

## Builds and release safety

`.github/workflows/docker-build.yml` builds AMD64 and ARM64 on matching native runners.
Repository variables `CI_RUNNER_X64` and `CI_RUNNER_ARM64` select the runner labels;
they default to `ubuntu-latest` and `ubuntu-24.04-arm`, respectively. Other CI workflows
also use `CI_RUNNER_X64`. Docker Buildx shares its local cache between steps within a job;
no cache is persisted between workflow runs.

| Trigger | Published aliases | Production deployment |
| --- | --- | --- |
| Push to `main` | `sha-*`, `nightly`, timestamped nightly | No |
| Manual dispatch, default `release=false` | `sha-*`, `canary-<run-id>-<attempt>` | No |
| Push of a `v*` tag or explicit `release=true` | `sha-*`, `latest`, version/major/minor | When configured: SSH redeploy and Cloudflare purge |

Manual `release=true` republishes the version already in `package.json` and runs configured
production integrations. SSH redeployment requires `SSH_KEY`, `SSH_HOST`, and `SSH_USER`;
Cloudflare purging requires `CLOUDFLARE_ZONE_ID` and `CLOUDFLARE_API_TOKEN`. Each integration
is skipped if any of its required secrets is missing. Dispatch does not create a Git tag,
GitHub release, or version bump. Use this for an approved current-version rebuild;
it replaces the existing stable image aliases.

Manual canaries first run a cache-only build on each architecture, then publish, merge,
and sign images in the enabled registries. Run one with:

```bash
gh workflow run docker-build.yml --repo reactive-resume/reactive-resume --ref main -f release=false
```

Published images retain SBOMs, maximum provenance, and Cosign signatures. GHCR always uses
the destination repository's `GITHUB_TOKEN` with `packages: write`. Docker Hub publishing
is enabled only when both `DOCKER_USERNAME` and `DOCKER_PASSWORD` secrets are present;
otherwise login, publishing, signing, and verification target GHCR only. Image references
are normalized to lowercase. New GHCR packages need public visibility, repository linkage,
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
`https://github.com/reactive-resume/reactive-resume/.github/workflows/docker-build.yml@<ref>`.
Historical signatures and image source labels retain the old repository identity. Verify
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
