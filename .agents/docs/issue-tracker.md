# Issue tracker

Planned work lives in **Linear**, team **Reactive Resume** (key `RX`): tickets are `RX-<n>`, the spec is the issue
description plus its comments and attachments. Public bug reports and feature requests arrive as **GitHub issues** on
`reactive-resume/reactive-resume`; use `gh issue view <n> --comments` for those.

## Read and write Linear tickets

- **Claude Code** with the Linear connector: `get_issue` (description), `list_comments` (discussion; `get_issue`
  omits it), `get_attachment`, `extract_images` for embedded screenshots, `save_comment`, `save_issue`.
- **Shell or Codex**: the Composio CLI. Several Linear accounts are connected, so always pass `--account`; the alias
  and workspace IDs are in the maintainer's private notes at `~/Projects/reactive-resume-private/ops/linear.md`.

```sh
composio execute LINEAR_RUN_QUERY_OR_MUTATION --account <alias> -d '{
  "query_or_mutation": "query { issue(id: \"RX-123\") { id identifier title description state { name } labels { nodes { name } } branchName comments { nodes { body createdAt } } attachments { nodes { title url } } } }",
  "variables": {}
}'
```

`issue(id:)` accepts the `RX-<n>` identifier. Comment with `commentCreate(input: { issueId, body })`, where `issueId`
is the issue's UUID from the query above. Large Composio results are written to a file whose path is in the response.

## States

| State       | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| Backlog     | Not scheduled.                                                |
| Todo        | Scheduled, nobody working on it.                              |
| In Progress | Someone owns it and is working on it.                         |
| In Review   | A pull request is open and under review.                      |
| Done        | Merged to `main`.                                             |
| Canceled    | Won't be done. `Duplicate` marks a ticket covered by another. |

## Labels

- **Type**: `Bug`, `Feature`, `Improvement`.
- **Owner agent**: `Claude`, `Codex` or `DeepSeek` marks which agent thread owns the ticket. Leave tickets labelled for
  another agent alone unless the owner reassigns them; coordinate through Linear comments.

## Conventions

- Branch: `feature/rx-<n>` (Linear's `branchName`). Mention `RX-<n>` in the pull request body.
- Ticket notes (delivery logs, handoffs, review results, evidence) go on the Linear issue as comments, never into files
  in this repository. Durable knowledge that outlives the ticket goes in `.agents/docs/` (see its `README.md`).
