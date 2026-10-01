# MCP evaluation fixture

Ten independent questions exercise application links, submitted snapshots, current documents, version history, interviews, timezones, skill requirements and contacts. Answers use fixed authored facts from September 2024. Read-only evaluation requires multiple tool calls; page through lists with `limit: 1` to exercise pagination.

`fixture.ts` supplies three synthetic resumes, three applications and two letters. `seed.ts` creates named baseline versions and submitted snapshots, then changes one current employer and one current letter so historical answers cannot be recovered from current documents alone. No real personal data or provider calls are involved.

## Validate without requests

From the repository root:

```sh
pnpm --filter @reactive-resume/tooling exec tsx mcp/seed.ts
```

This is the default dry-run. It validates canonical resume data and derives all ten XML answers by traversing the fixture relationships. It does not read environment credentials or contact a server.

## Load a disposable local account

Start a dedicated test installation using the repository's development setup. Create an empty evaluation account and a key with `read` and `write` permissions in Settings → AI & developer → API keys. Set that key through your shell's secret input or environment manager as `MCP_EVALUATION_API_KEY`.

```sh
export MCP_EVALUATION_APP_URL=http://127.0.0.1:3000
pnpm --filter @reactive-resume/tooling exec tsx mcp/seed.ts --seed
```

The seeder accepts only HTTP loopback origins, refuses redirects and refuses accounts containing resumes, applications or letters. `--seed` explicitly enables writes. It never prints credentials. A partial failure leaves created records available for inspection; use a fresh disposable account for another run. Do not modify the fixture records after loading.

## Run model evaluation

Create a second key for the same account with only `read` permission. Expose it as `MCP_EVALUATION_READ_API_KEY`. Keep the seeding key out of the model harness environment. Authenticated GET operations and prompt/resource reads provide the facts; no AI tools, exports, checks or mutations are needed.

The installed `mcp-builder` skill supplies `scripts/evaluation.py`. Run it in a separate Python environment with its own `scripts/requirements.txt`; these dependencies are not added to this repository. Set the model provider credential required by that harness. Set `MCP_BUILDER_SKILL` to the installed skill directory and `MCP_EVALUATION_MODEL` to a model supported by your evaluator/provider. From the repository root:

```sh
python - <<'PY'
import os
import runpy
import sys

skill = os.environ["MCP_BUILDER_SKILL"]
key = os.environ["MCP_EVALUATION_READ_API_KEY"]
base = os.environ.get("MCP_EVALUATION_APP_URL", "http://127.0.0.1:3000")
sys.argv = [
    "evaluation.py", "tooling/mcp/evaluation.xml",
    "-t", "http", "-u", base.rstrip("/") + "/mcp",
    "-m", os.environ["MCP_EVALUATION_MODEL"],
    "-H", "x-api-key: " + key,
    "-o", "/tmp/reactive-resume-mcp-evaluation.md",
]
runpy.run_path(skill + "/scripts/evaluation.py", run_name="__main__")
PY
```

The report compares each answer by exact string match and records model tool usage. Using an environment-fed header avoids putting the key in shell history or the operating system process argument list. Each question must use fresh reasoning without relying on previous question results.

Fixture validation has been run. Local seeding, live MCP answer verification and a model evaluation run have not been performed; fixture checks establish authored-answer consistency, not end-to-end model accuracy.
