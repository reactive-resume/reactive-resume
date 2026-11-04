# Turbo remote cache

Main-branch CI and Docker builds share Turbo task results through Vercel Remote Cache. Vercel deployments
of the same team use it automatically. Pull requests keep only the Actions cache, which restores main's latest
results, so nothing they build reaches a published image or a Vercel deployment.

## Setup

1. In the Vercel team that owns the deployment: Settings → Build and Deployment → OIDC Policies for CLI Access →
   add a Turborepo CLI policy with a custom issuer and claims. A GitHub-preset policy rejected this repository's
   tokens with `Not authorized.`: the repository uses GitHub's immutable OIDC subject, so `sub` carries owner and
   repository IDs instead of names.
   - Issuer: `https://token.actions.githubusercontent.com`
   - Audience: `https://github.com/reactive-resume` (GitHub's default; the action requests none)
   - Claim `sub`: `repo:reactive-resume@245328954/reactive-resume@249995750:ref:refs/heads/main`, which also limits
     tokens to main-branch runs
2. Add the repository variable `TURBO_TEAM` with the team slug (`gh variable set TURBO_TEAM --body <slug>`).

No secret is stored: `vercel/setup-turborepo-remote-cache-action` exchanges each job's GitHub OIDC token for a
short-lived Turbo token and revokes it when the job ends. Without `TURBO_TEAM`, or on a ref the policy doesn't
match, the step is skipped or fails softly and builds run as before.

## Where it applies

- `ci.yml` test job, push events only (main): unit `test:ci`, typecheck and the browser suite's build.
- `docker-publish.yml` build job: the token reaches the image build as the `TURBO_TOKEN` BuildKit secret, never a
  build arg, because published provenance records build args. `TURBO_TEAM` is an ordinary build arg.

## Keeping hashes equal

A Docker build only reuses checkout results when Turbo computes the same task hashes in both places. The
Dockerfile restores what `turbo prune` changes or drops: the original root `package.json`, `.gitignore` (without
it, Turbo hashes `node_modules/.bin` links), and the `globalDependencies` files. Check after changing `turbo.json`
globals or the Dockerfile's builder stage: compare `pnpm exec turbo run build --filter=web --filter=server
--dry=json` task hashes from a checkout with the same command run in the builder stage.

The build task hashes the root `package.json` because web and server embed its version; without it, a release
commit that only bumps the version would restore the previous build.
