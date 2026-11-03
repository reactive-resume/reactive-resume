---
name: release
description: Use when releasing a new version of Reactive Resume — bumping the version, writing the changelog entry, creating the GitHub release, or when asked to "cut a release" / "release vX.Y.Z".
---

# Release Reactive Resume

One pipeline: version bump → changelog entry → PR → squash-merge → tag → GitHub release. The changelog entry and the GitHub release body are the same text.

## Steps

1. **Scope the release.** Previous tag: `git tag --sort=-creatordate | head -1`. Changes: `git log vPREV..HEAD --format='%h %s'`. Confirm the new version with the user if not given (patch unless there's a headline feature).
2. **If this cycle added user-facing strings**, run fill-translations first so catalogs ship complete.
3. **Bump the version** — root `package.json` only; no other file carries it.
4. **Write the changelog entry** at the TOP of `docs/changelog/index.mdx` (right after the frontmatter), in house style — use changelog-generator for the prose, then fit it to this exact shape:

   ```mdx
   <Update label="vX.Y.Z" description="7th July 2026">
   ## Highlights

   - **Bold feature lead.** One or two sentences of user-facing benefit — what it does for the user, not how it's implemented. [abc123def](https://github.com/reactive-resume/reactive-resume/commit/abc123def)

   ## Thematic Section (e.g. Resume Builder, Import & Export, Self-Hosting & Maintenance)

   - Past-tense entry ("Added…", "Fixed…", "Improved…") with commit links. [abc123def](...)

   **Full Changelog**: [vPREV...vX.Y.Z](https://github.com/reactive-resume/reactive-resume/compare/vPREV...vX.Y.Z)

   </Update>
   ```

   Conventions: date is ordinal ("7th July 2026"); every bullet links its commit(s) as `[shortsha](commit url)`; group by theme, Highlights first; write for users of the app and self-hosters, not for contributors. Thank external contributors by handle where relevant.

5. **Run checks**: `pnpm check`, `pnpm typecheck`, `pnpm test`.
6. **PR**: non-draft, against `main`. Short summary + bullets of changes in the body. **No mention of Claude/Codex/AI anywhere in title, body, or commits.** Squash-merge once CI is green, then wait for the post-merge checks on `main` to pass (`gh pr checks --watch`, then watch the main run).
7. **Tag and release** from updated `main`:

   ```bash
   git checkout main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   gh release create vX.Y.Z --title vX.Y.Z --notes-file release-notes.md
   ```

   Write the release body to `release-notes.md` first, and delete the file afterwards. The body is the new `<Update>` block's inner content (Highlights through Full Changelog line), without the `<Update>` wrapper.

8. **Update the Cloudron package** once the release image is on GHCR: follow `cloudron/README.md` (manifest `version`, `CHANGELOG`, `npx cloudron versions add --image ghcr.io/reactive-resume/reactive-resume:v<version>`), then commit `cloudron/` to `main`.
9. **Optional, on request**: screenshots for the changelog/docs (via agent-browser against the running app) and a LinkedIn/Reddit announcement draft based on the Highlights.

## Common Mistakes

| Mistake                                      | Reality                                                    |
| -------------------------------------------- | ---------------------------------------------------------- |
| Bumping versions in `apps/*` or `packages/*` | Only the root `package.json` has a version.                |
| Appending the entry at the bottom            | Newest `<Update>` goes first, directly after frontmatter.  |
| Implementation-speak in the changelog        | Readers are end users and self-hosters; describe benefits. |
| Tagging before the squash-merge lands        | Tag the merged commit on `main`, never the branch.         |
| ISO dates in the description                 | House style is ordinal: "7th July 2026".                   |
