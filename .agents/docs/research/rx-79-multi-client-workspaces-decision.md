# RX-79 multi-client workspaces: evaluation and decision

Decision (November 2, 2026): **no-go for now**. Do not build operator or multi-client workspaces until the RX-77 feedback-link pilot shows the demand described under "Revisit when". This record keeps the ownership model, permission boundaries and approval rules worked out here, so a later implementation starts from them instead of from shared logins or extra resumes.

## Why not now

- **No demand evidence yet.** RX-79 is conditional on APP-08 (RX-77) showing that people apply on behalf of several clients. RX-77 shipped a limited pilot ([#3848](https://github.com/reactive-resume/reactive-resume/pull/3848)): one owner shares one resume version with one reviewer, optionally with read-only application progress. It has no usage yet. Agents cannot interview coaches, nonprofits or university services; that research needs the owner.
- **It is a new ownership model.** Every table is owned by one `user_id`, and every service checks that owner. Delegation would touch all API, MCP, mobile and background-job entry points at once. The cost is only justified by measured demand.
- **The pilot already covers the common, lower-risk need.** Review and feedback on a fixed version, with revocation and activity history, is what most coaches and careers offices ask for first. Acting for a client (editing, applying) needs the model below.

## Revisit when

Revisit if, over the pilot, any of these holds (counts from `feedback_link`/`feedback_event`, opt-in research or support requests):

1. Accounts that create feedback links for **three or more different people's** resumes. That is a sign one person (a coach) is working for several clients from their own account.
2. Repeated requests from coaches, nonprofits or careers services to **edit** documents or **track applications for** clients, not just comment.
3. Owners asking reviewers to make changes and then re-sending a new link each time. That is a sign that comment-only links are too weak.

If none holds, keep the pilot as the collaboration feature and close the operator-workspace idea.

## Ownership and actor model (for a future implementation)

- **Owner**: the client. Owns resumes, letters, applications, Knowledge, profile answers and provider credentials, exactly as today. Ownership never transfers to the operator.
- **Operator**: a separate account (coach, case worker) acting in a client's account through a **membership** the client grants and can revoke.
- Every write records **actor** (who did it) and **owner** (whose data). Timeline entries, versions and activity show the actor.
- **Membership** rows: owner, operator, scopes, created/revoked times, granted-by. Revocation ends access at once, as feedback links do.
- Operators never see: provider credentials, API keys and OAuth connections, account security settings, data export, account deletion, or Knowledge and profile answers the client hasn't shared.

## Permission scopes

Separate grants, each optional, each listed in the client's settings:

| Scope              | Allows                                                        |
| ------------------ | ------------------------------------------------------------- |
| Comment            | What RX-77 links give today, but tied to a member, not a link |
| Edit documents     | Change chosen resumes and letters; every save is a version    |
| Track applications | Add and move applications; notes are marked with the actor    |
| Prepare to apply   | Build packets for client approval; never submit               |

There is no "submit on the client's behalf" scope. Submission stays with the client, as in RX-75 and RX-80.

## Approval and invalidation

- An operator-prepared packet (documents plus answers) needs **explicit client approval of exact versions**. This reuses RX-75's fingerprinted packet review.
- Any change to an approved document, answer or selection after approval **invalidates** it. The packet shows "changed since approval" and must be approved again.
- Submitted snapshots stay immutable, as today.

## Enforcement

- One check, `assertCanAct(actor, owner, scope)`, in `packages/api` next to `protectedProcedure`. Feature services call it instead of comparing `userId` directly.
- MCP tools, REST aliases, mobile and background jobs (career schedules, follow-ups) all go through it. A job runs as the owner, never as an operator.
- Export and deletion: memberships and actor history are part of the owner's export. Deleting the operator account removes memberships, not the owner's data.

## Not decided here

Ranking one posting across a client roster, operator billing, and organization accounts all depend on demand data and are out of scope.
