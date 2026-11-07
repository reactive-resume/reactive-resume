# Repository contract

Provide `LocalRepositories` from one app-scoped `RrRepositories`. Feature modules depend on `:core:data` and import
DTOs from `me.rxresu.core.network.generated`. Run `./gradlew :core:network:generateApiClient` before inspecting the
DTOs: sources live in `core/network/build/generated/rr-api/kotlin`, and are never committed.

Every inherited `*ApiOperations` method is part of its repository's contract. Methods retain the OpenAPI
operationId (punctuation becomes camel case), typed parameters/body and response. Optional request fields default
to null: omission keeps existing values; an explicit empty list clears a list. Use
`RequestOptions(nullFields = setOf("/followUpAt"))` to explicitly clear a nullable field (nested JSON pointers work).
Draft handles preserve explicit nulls automatically, including unlinking a letter from its resume or application.
`*Multipart` overloads accept actual `UploadPart` bytes. SSE operations return cold `Flow<ServerEvent>`;
collection cancellation closes the connection. File exports return `BinaryFile`.

| Holder property | Operation interfaces and additions                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `account`       | Authentication, Application Profile, Files; session, `observeProfile`, `securityInfo`, sign out           |
| `documents`     | Documents; `observe(DocumentQuery)`, refresh, duplicate resume or letter                                  |
| `resumes`       | Resumes, Resume Sharing, Resume Statistics, Custom Domain, Feedback Links; `openDraft`                    |
| `letters`       | Cover Letters; `openDraft`                                                                                |
| `applications`  | Applications; `observe(ApplicationQuery)`, refresh, calendar, insights                                    |
| `checks`        | Checks plus `getResumeChecks`                                                                             |
| `ai`            | AI, AI Providers, Integrations                                                                            |
| `assistant`     | Agent, including threads, attachments, edit status and send/resume/stop                                   |
| `workspace`     | Career and Applications: saved results, reviewed answers, packets, submission, preparation and recordings |
| `career`        | Career: profile, facts, stories, offers, schedules, opportunities and notifications                       |
| `publicResume`  | Resume Sharing and Feedback Links; public methods default to unauthenticated requests                     |
| `platform`      | System, Feature Flags, Platform Statistics                                                                |
| `search`        | `search(query, scope)`, account-scoped recent searches, `remember`                                        |
| `today`         | `observe(remindersEnabled)`, refresh, mark notification read, dismiss/undo item, track/dismiss role       |
| `preferences`   | Values flow; theme, haptics, motion override, last tab and four notification categories                   |
| `drafts`        | Current account's pending documents and explicit sync                                                     |
| `pages`         | Injected `PageRenderer`                                                                                   |

`Resource<T>` exposes loading, cached data, offline and error independently. Refresh failure retains last good
cached data. Calling a plain suspend API method surfaces its error. `TimeSource` supplies clock and timezone;
`applicationNextStep` and `followUpInstant` use it, including legacy date-only reminders. Insights retain closed
application history, skip lane-only transitions and leave undated replies out of elapsed-time calculations.

## Builder ownership

`resumes.openDraft(id)` and `letters.openDraft(id)` return the same live handle for one account/document. The builder
layout owns `close`; assistant/share children reuse it. Observe `draft.state`, call `update` for authored changes,
`setEditing(true)` on focus and `setEditing(false)` on blur. Updates reach Room before autosave is scheduled.
`flush` is for navigation/background transitions and Retry. Close refuses an unpersisted storage error so the UI
can keep the person's text. Session changes hide another account's draft and retain its queued work.

Undo/redo carry reviewed proposal marks. Pass only actual reviewed acceptance/undo marks as `proposalApplications`
(id to reviewed wording, `snapshot:<id>`, or boolean). The server remains the decision validator; ordinary content
saves always send `proposalSafety: v1`. A conflicted save keeps an editable `(mine)` copy before replacing the
original, exposes `recoveredCopyId`/`recoveredCopyName`, and never acknowledges a newer edit with an older response.

Metadata writes must use the draft's save owner so their new revision does not conflict with the next autosave:

```kotlin
draft.writeMetadata { baseline ->
    baseline.withWriteResult(repositories.resumes.updateResume(
        baseline.id,
        UpdateResumeRequest(name = newName, expectedUpdatedAt = baseline.updatedAt),
    ))
}
```

## App integration

Create `realRepositories(context, authSession, pageRenderer, onRejectedRetry, time)` once. `onRejectedRetry` must tell
`:core:auth` to expire the rejected access token; the committed `SessionTokens`/`AuthSession` contracts expose no
such method. Keep that handling in auth, including rejected-token identity checks. Install the returned
`workerFactory` through the app's WorkManager `Configuration.Provider`, removing WorkManager's default initializer.
The worker runs only with a network connection and the matching signed-in account. Do not create a second graph
in the worker. Supply the selected account timezone through `TimeSource.timezone`.

`FakeRepositories(controls, time, authSession, pageRenderer, coroutineScope)` uses the same typed APIs and save owner.
Default time is 7 November 2026 in Lisbon. `StoryboardIds` names the common documents/jobs/interview/story.
`FakeControls` switches ready/empty/loading/error globally or by operation, controls connectivity, and accepts
server-shaped response overrides. Fakes keep common CRUD actions in memory; generated structural samples cover
unseeded responses and simulated AI/check actions. Preview paper is illustrative; production uses the injected
server PDF renderer. Screenshot scenarios can inject a page renderer and focused response overrides.

Browser-only security is explicit through `AccountSecurityInfo.BrowserRequired`. OpenAPI omits two-step/passkey/session
management and forbids bearer callers from creating API keys, setting passwords or deleting accounts. Public PDF
checks/import previews still require authentication in this API; the signed-out local ATS flow needs a native
checker or an additional server endpoint. Public-resume password grants are short-lived, memory-only cookies,
partitioned by server/account; bearer authentication is never replaced by a browser auth cookie.
