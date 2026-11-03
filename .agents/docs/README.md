# Agent docs

Tracked reference for coding agents working on Reactive Resume. Everything here is in git, so it exists in every
worktree. `pnpm check:agent-docs` checks that repo paths named in these docs exist.

| Path               | Holds                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------- |
| `issue-tracker.md` | Linear `RX` tickets and GitHub issues: reading specs, states, labels, branches          |
| `decisions/`       | Decision records: what was decided, why, and what would reopen it                       |
| `research/`        | Investigations behind decisions; historical, so paths in them may be gone               |
| `runbooks/`        | Maintainer procedures: container publishing, mobile CI and releases, Turbo remote cache |

## What goes where

- **Durable and public-safe** (a convention, a runbook, a decision): here. Name files by topic, never by ticket;
  `check:agent-docs` rejects ticket IDs in file names.
- **Contributor-facing** (setup, tests, translations): `docs/contributing/`, which humans also read on the docs site.
- **Area guides**: an `AGENTS.md` in the area's folder, with a `CLAUDE.md` symlink beside it, listed in the root
  `AGENTS.md`.
- **Ticket notes** (delivery logs, handoffs, review results, evidence): a comment on the Linear issue.
- **Private maintainer notes** (store accounts, secret locations, production topology, personal data): outside the
  repository, in `~/Projects/reactive-resume-private/` on the maintainer's machine. Never commit them here.
- **Repo skills**: `.agents/skills/<name>/SKILL.md`. Only skills allow-listed in `.gitignore` are tracked.

New decision records take the next number: `decisions/NNNN-topic.md` with a `Status:` line and dated decision.
