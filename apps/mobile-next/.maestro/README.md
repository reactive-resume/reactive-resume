# Storyboard Maestro contracts

Authoring only: none of these flows has been run on a device in this work. They are contracts, not a green device gate.

Run from `apps/mobile-next` with a storyboard development build (`APP_VARIANT=storyboard`, `EXPO_PUBLIC_STORYBOARD=1`, app ID and scheme `me.rxresu.storyboard`). Metro and the native app must already be available. Never point these flows at a production account. S7 flows clear the storyboard sandbox with `launchApp.clearState`; install a dedicated test variant.

```sh
maestro test .maestro/haptics/segment.yaml
maestro test .maestro/haptics
maestro test .maestro/behaviour
```

The retained `f/c7-connection-changed.yaml` is a separate legacy real-server flow for `me.rxresu.dev`, requiring `SCHEDULE_ID` and `OTHER_CONNECTION_LABEL`. It is not part of the storyboard folders above. For `behaviour/s7-file.yaml`, preload a nonpersonal PDF in Files and supply `-e IMPORT_FIXTURE_NAME=<visible filename>`. Microphone permission must be granted for `s7-audio.yaml`.

Each haptic flow clears the visible `haptic-log` pill and asserts an exact sequence, including an empty string for silent actions. The four former motion-lab placeholders now use actual screens. Existing screen flows were relocated without removing their assertions. The sign-out preset currently supplies **three** queued changes, not the specification row’s two; both must open S8 once with `warning`, but exact two-change fixture coverage is missing.

Storyboard capture temporarily sets `timeScale=0`, restoring 1 four seconds after capture completion. Wait for that restoration before measuring motion. `waitForAnimationToEnd` alone does not prove the scale has reset. The tour contains no frame-pacing instrumentation; the lead records gfxinfo/xctrace, real pinch and busy-JS evidence separately. No supported pinch syntax was established by the fetched Maestro documentation, so no invented command is included.

`j8-repeated-hour.yaml` and `s8-export.yaml` are explicitly incomplete drafts: their comments identify native interactions the lead must author before they can pass. No fake app selector substitutes for a native picker. Board gestures and row swipes use inherited/calibrated coordinates only as authoring starting points; remeasure on both platforms before relying on them. The board contract intentionally fails while BoardView is static. J5 intentionally expects success and the Applied gate even though SaveJobScreen currently cannot save.

## Flow inventory

| Flow                                                                       | Contract / limitation                                                                                           |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [b/restore.yaml](b/restore.yaml)                                           | b · restore                                                                                                     |
| [behaviour/applied-board.yaml](behaviour/applied-board.yaml)               | Blocked: board drag absent.                                                                                     |
| [behaviour/applied-bulk.yaml](behaviour/applied-bulk.yaml)                 | Applied means sent: a bulk move to Applied asks for each application in turn; cancelling changes nothing.       |
| [behaviour/applied-confirm.yaml](behaviour/applied-confirm.yaml)           | Confirming "What did you send?" freezes what was ticked and moves the application to Applied (`success`).       |
| [behaviour/applied-j5.yaml](behaviour/applied-j5.yaml)                     | Expected failure: save/create and gate unimplemented.                                                           |
| [behaviour/applied-j7.yaml](behaviour/applied-j7.yaml)                     | Applied means sent: J7's Applied opens "What did you send?"; closing it changes nothing.                        |
| [behaviour/applied-swipe.yaml](behaviour/applied-swipe.yaml)               | Kiln is Saved; lead must calibrate swipe to its row. Cancellation must retain Saved.                            |
| [behaviour/applied-w2.yaml](behaviour/applied-w2.yaml)                     | behaviour · applied w2                                                                                          |
| [behaviour/b20-empty-back.yaml](behaviour/b20-empty-back.yaml)             | B20: leaving a new entry with nothing typed creates nothing and shows no toast.                                 |
| [behaviour/b3-undo-redo.yaml](behaviour/b3-undo-redo.yaml)                 | B3: Undo in the status line reverts the last field edit; Redo appears after an Undo and restores it.            |
| [behaviour/j8-repeated-hour.yaml](behaviour/j8-repeated-hour.yaml)         | Incomplete draft: native picker date/time selection needed.                                                     |
| [behaviour/j9-close-reopen.yaml](behaviour/j9-close-reopen.yaml)           | J9: close with an outcome (`success` for "I accepted this offer"), then Reopen from J6.                         |
| [behaviour/l1-undo-redo.yaml](behaviour/l1-undo-redo.yaml)                 | behaviour · l1 undo redo                                                                                        |
| [behaviour/s7-audio.yaml](behaviour/s7-audio.yaml)                         | Needs microphone permission and nonempty native recording.                                                      |
| [behaviour/s7-chat.yaml](behaviour/s7-chat.yaml)                           | Authored; repeated send may expose disabled retry after failure.                                                |
| [behaviour/s7-file.yaml](behaviour/s7-file.yaml)                           | Needs preloaded IMPORT_FIXTURE_NAME and native Files picker.                                                    |
| [behaviour/s7-posting.yaml](behaviour/s7-posting.yaml)                     | Authored; awaits lead device validation.                                                                        |
| [behaviour/s7-resume-and-facts.yaml](behaviour/s7-resume-and-facts.yaml)   | Authored; awaits lead device validation.                                                                        |
| [behaviour/s8-discard.yaml](behaviour/s8-discard.yaml)                     | behaviour · s8 discard                                                                                          |
| [behaviour/s8-export.yaml](behaviour/s8-export.yaml)                       | Incomplete draft: native Files destination selection needed.                                                    |
| [behaviour/s8-offline.yaml](behaviour/s8-offline.yaml)                     | behaviour · s8 offline                                                                                          |
| [behaviour/schedule-connection.yaml](behaviour/schedule-connection.yaml)   | Authored against fake provider key update.                                                                      |
| [behaviour/toast-touch.yaml](behaviour/toast-touch.yaml)                   | behaviour · toast touch                                                                                         |
| [behaviour/trash-restore-delete.yaml](behaviour/trash-restore-delete.yaml) | behaviour · trash restore delete                                                                                |
| [d/preview-zoom.yaml](d/preview-zoom.yaml)                                 | d · preview zoom                                                                                                |
| [f/c7-connection-changed.yaml](f/c7-connection-changed.yaml)               | Existing separate real-server dev-account contract; environment variables required.                             |
| [f/p2-signed-out.yaml](f/p2-signed-out.yaml)                               | f · p2 signed out                                                                                               |
| [haptics/board-drop.yaml](haptics/board-drop.yaml)                         | Blocked: board drag absent; calibrate card/edge coordinates after wiring.                                       |
| [haptics/builder-dock.yaml](haptics/builder-dock.yaml)                     | B1: the dock's Edit → Design switch plays `selection`.                                                          |
| [haptics/delete-entry.yaml](haptics/delete-entry.yaml)                     | B21 › Delete entry → `light`; the toast offers Undo.                                                            |
| [haptics/delete-permanently.yaml](haptics/delete-permanently.yaml)         | haptics · delete permanently                                                                                    |
| [haptics/forget.yaml](haptics/forget.yaml)                                 | C3 Forget emits one light; Show forgotten and Restore retain the reversible action.                             |
| [haptics/long-press.yaml](haptics/long-press.yaml)                         | haptics · long press                                                                                            |
| [haptics/move-down.yaml](haptics/move-down.yaml)                           | B21 › Move down → `selection`; the entry moves under its neighbour.                                             |
| [haptics/proposal.yaml](haptics/proposal.yaml)                             | haptics · proposal                                                                                              |
| [haptics/refresh-today.yaml](haptics/refresh-today.yaml)                   | haptics · refresh today                                                                                         |
| [haptics/reorder.yaml](haptics/reorder.yaml)                               | B8: drag a section down two slots by its handle → "medium selection selection rigid".                           |
| [haptics/root-tab.yaml](haptics/root-tab.yaml)                             | haptics · root tab                                                                                              |
| [haptics/save-job.yaml](haptics/save-job.yaml)                             | Expected failure: saving is unimplemented.                                                                      |
| [haptics/segment.yaml](haptics/segment.yaml)                               | J1 List → Board: the view switch plays `selection` (MOTION.md §12, J1).                                         |
| [haptics/sign-out-offline.yaml](haptics/sign-out-offline.yaml)             | S1 → S8: Sign out with three queued changes while offline opens S8 and plays `warning`; Keep working closes it. |
| [haptics/swipe-cancel.yaml](haptics/swipe-cancel.yaml)                     | haptics · swipe cancel                                                                                          |
| [haptics/swipe-trash.yaml](haptics/swipe-trash.yaml)                       | haptics · swipe trash                                                                                           |
| [haptics/switch-on.yaml](haptics/switch-on.yaml)                           | haptics · switch on                                                                                             |
| [haptics/typing.yaml](haptics/typing.yaml)                                 | B3: typing plays no haptic (MOTION.md §4.2).                                                                    |
| [haptics/wrong-code.yaml](haptics/wrong-code.yaml)                         | A3: a wrong two-step code clears the boxes, says so and plays `error` (MOTION.md §5, §12).                      |
| [haptics/zoom-double-tap.yaml](haptics/zoom-double-tap.yaml)               | haptics · zoom double tap                                                                                       |
| [haptics/zoom-fit.yaml](haptics/zoom-fit.yaml)                             | haptics · zoom fit                                                                                              |
| [tour/motion-tour.yaml](tour/motion-tour.yaml)                             | Partial tour: manual pinch, calibrated gestures and real end-of-list confirmation required.                     |

## Missing app hooks and selectors

These are requests to owners, not selectors used speculatively by the flows:

| File / element                                                                                              | Request                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/features/applications/ApplicationsScreen.tsx`, `BoardView` card and columns                            | Wire real `BoardDrag` + `SnapCarousel`; expose `board-card-${id}`, `board-column-${status}`, `applications-board` so edge hold/drop targets can be measured. Current board is static.                                 |
| `src/features/builder/design/LayoutScreen.tsx`, `SectionRow` drag handle                                    | `section-drag-${id}` for B8’s two-slot drag. Existing labels permit Move up/down but do not locate the handle.                                                                                                        |
| `src/ui/SwipeRow.tsx`, gesture surface                                                                      | Expose real accessibility actions for start/end actions (also usable in Jest). No imperative handle or accessibility action exists on SwipeRow itself; pure `swipeArm` tests do not prove gesture emission or commit. |
| `src/ui/BottomSheet.tsx`, grabber                                                                           | `sheet-grabber` for precise drag-dismiss targeting.                                                                                                                                                                   |
| `src/ui/PageZoom.tsx`, page gesture surface                                                                 | `page-zoom` for double-tap/pinch target bounds.                                                                                                                                                                       |
| `src/ui/Toast.tsx`, toast surface                                                                           | `toast` for holding the full surface without accidentally triggering Undo. Native touch pause is covered by the rendered Jest test.                                                                                   |
| `src/features/applications/InterviewSheet.tsx`, Starts row and native picker                                | `interview-starts` and `interview-starts-picker`; platform date/time picker automation must select 2026-10-25 02:30 Europe/Berlin. Save currently always reports an error.                                            |
| `src/features/today/screen.tsx` and `src/features/applications/ApplicationsScreen.tsx`, scroll content ends | Stable end-of-content markers (`today-end`, `applications-end`) for actual end-to-end tour scrolling. Current tour uses known bottom sections/rows, which cannot prove absolute end.                                  |
| Storyboard S1 offline queue preset                                                                          | Two queued writes fixture needed for the literal 10.3 row; existing preset supplies three.                                                                                                                            |

S7 file and S8 export require platform-native Files steps; no missing app test ID can replace selecting a real file/destination. Direct links to `/ai/consent` are not proof of once-per-kind behavior: the new S7 flows invoke actual feature request guards and change the fake provider key without reseeding between requests. Native recording and picker dialogs remain lead-owned.

## Jest boundary and navigation limitations

`src/ui/interactions.test.tsx` uses resolver-backed Reanimated with fake timers; existing helper/config tests remain in `motion.test.ts` and `controls.test.ts`. Controls are activated through their real accessibility tap/action handlers. Pan/reorder use real imperative handles. Their initial render is silent; accessibility activation does **not** prove physical touch-down silence. Haptic Maestro rows and device review must establish that gesture phase.

BoardDrag’s handle requires measured native root/card views; Jest host refs do not deliver those measurements. No production test-only geometry seam was added. Its pure edge-zone helper remains covered; real `medium selection rigid` must be proved after board integration on-device. SwipeRow likewise remains helper-only in Jest until an honest allowed driver is available.

`edges.test.ts` reads every `navigatesTo` element from the external layout bundle and checks the single ID-to-pathname table plus actual route files. It searches local imports of the source route for literal/template `router.push`, `router.replace` or `Link` pathnames. It is syntactic evidence, not route execution. Query-selected subviews share a pathname and are not distinguished. Back/dismiss, navigator-owned docks, computed hrefs, indirect helpers and conditional branches may remain unproved. Every unproved element is listed in the test failure; none is silently waived. Only an absent external bundle skips this test, with an explicit test title. Re-run after owner fixes; do not convert navigation gaps to skips.
