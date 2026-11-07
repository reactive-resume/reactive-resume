// Every destination in the storyboard (SCREENS.md), as type-safe Navigation Compose routes.
// Screen IDs in the comments match /.agents/handoff/android-app/SCREENS.md. Sheets are registered with `sheet<T>()`.
package me.rxresu.core.navigation

import kotlinx.serialization.Serializable

// Before the tabs (owner: :feature:auth)
/** A1. */
@Serializable data object Welcome
/** A2. `register` swaps the form for Create account. */
@Serializable data class SignIn(val register: Boolean = false)
/** A2 forgot-password sheet. */
@Serializable data object ForgotPassword
/** A2 "Create new password", opened by the reset link. */
@Serializable data class ResetPassword(val token: String)
/** A3. */
@Serializable data class TwoStep(val backup: Boolean = false)
/** A4. `query` is the raw OAuth authorize query string from the connect link. */
@Serializable data class Consent(val query: String)

// The four tabs. The tab bar shows only on these four destinations.
/** T1, T2 (owner: :feature:today). */
@Serializable data object TodayTab
/** D1 (owner: :feature:documents). */
@Serializable data object DocumentsTab
/** J1–J4 (owner: :feature:applications). */
@Serializable data class ApplicationsTab(val view: ApplicationsView = ApplicationsView.List)
/** C1 (owner: :feature:career). */
@Serializable data object CareerTab

enum class ApplicationsView { List, Board, Calendar, Insights }
enum class DocumentKind { Resume, Letter }

// Documents (owner: :feature:documents, search: :feature:search)
/** D2 sheet. */
@Serializable data class DocumentActions(val id: String, val kind: DocumentKind)
/** D3 sheet. */
@Serializable data object NewDocument
/** D4. `fileUri` is set when a PDF or DOCX arrives from the share sheet. */
@Serializable data class Import(val fileUri: String? = null)
/** D5. `scope` narrows the results (documents, applications, career, settings). */
@Serializable data class Search(val scope: String? = null)
/** D6. */
@Serializable data class Trash(val tab: TrashTab = TrashTab.Documents)
enum class TrashTab { Documents, Applications }

// Resume builder (owner: :feature:builder unless noted). Share mode (B11) is a slot inside the builder screen,
// filled by :feature:share, so the mode bar never moves.
enum class BuilderMode { Write, Design, Check, Share }
enum class WriteView { Page, Outline }
enum class DesignGroup { Template, Type, Layout }
enum class CheckTab { Issues, JobMatch }

/** B1, B3, B6–B11. */
@Serializable data class Builder(
    val resumeId: String,
    val mode: BuilderMode = BuilderMode.Write,
    val view: WriteView = WriteView.Page,
    val group: DesignGroup = DesignGroup.Template,
    val check: CheckTab = CheckTab.Issues,
)
/** B2 sheet. `itemId` null = new item in `section`. */
@Serializable data class BuilderEntry(val resumeId: String, val section: String, val itemId: String? = null)
/** B4. `field` is the rich-text field path inside the item (usually "description"). */
@Serializable data class BuilderRichText(val resumeId: String, val section: String, val itemId: String, val field: String = "description")
/** B5. */
@Serializable data class BuilderBasics(val resumeId: String)
/** B18 sheet. */
@Serializable data class BuilderMore(val resumeId: String)
/** B12 (owner: :feature:share). */
@Serializable data class WebPageSettings(val resumeId: String)
/** B13 (owner: :feature:share). */
@Serializable data class Visitors(val resumeId: String)
/** B14 sheet, also the letter Export (owner: :feature:share). */
@Serializable data class Download(val id: String, val kind: DocumentKind)
/** B15 (owner: :feature:share). */
@Serializable data class Versions(val resumeId: String)
/** B16 full-height sheet (owner: :feature:assistant). */
@Serializable data class Assistant(val resumeId: String, val threadId: String? = null)
/** B17 (owner: :feature:assistant). */
@Serializable data class AssistantProposals(val resumeId: String, val threadId: String)

// Letters (owner: :feature:letters)
enum class LetterMode { Write, Design }
/** L1, L2. Export opens Download(id, Letter). */
@Serializable data class Letter(val letterId: String, val mode: LetterMode = LetterMode.Write)

// Applications (owner: :feature:applications). Workspace tabs (W1–W5) are a slot inside the Application screen,
// filled by :feature:workspace.
enum class WorkspaceTab { Overview, Fit, Apply, Prepare, Practise, Debrief, Messages, Saved }
/** J5 sheet. `url` is set when a link arrives from the share sheet. */
@Serializable data class SaveJob(val url: String? = null)
/** J6, W1–W5. */
@Serializable data class Application(val id: String, val tab: WorkspaceTab = WorkspaceTab.Overview)
/** J7 sheet. */
@Serializable data class MoveApplication(val id: String)
/** J8 sheet. `interviewId` null = new interview. */
@Serializable data class InterviewSheet(val applicationId: String, val interviewId: String? = null)

// Career (owner: :feature:career)
enum class KnowledgeTab { Facts, Stories, Preferences }
/** C2. */
@Serializable data class Coach(val conversationId: String? = null)
/** C3, C5. */
@Serializable data class Knowledge(val tab: KnowledgeTab = KnowledgeTab.Facts)
/** C4. `id` null = new story. */
@Serializable data class Story(val id: String? = null)
/** C6. */
@Serializable data object Offers
/** C7 sheet. */
@Serializable data class ScheduleSheet(val id: String? = null)

// Settings: full-screen modal graph opened from the avatar (owner: :feature:settings)
/** S1. */
@Serializable data object Settings
/** S2. */
@Serializable data object SettingsAccount
/** S3. */
@Serializable data object SettingsPreferences
/** S4. */
@Serializable data object SettingsProfile
/** S5. */
@Serializable data object SettingsAi
/** S6 sheet. `providerId` null = add. */
@Serializable data class AiProviderSheet(val providerId: String? = null)

// Outside the app (owner: :feature:public)
/** P1. `url` is the full public resume or feedback link. */
@Serializable data class PublicResume(val url: String)
/** P2. `fileUri` is set when a PDF arrives from the share sheet. */
@Serializable data class AtsChecker(val fileUri: String? = null)
