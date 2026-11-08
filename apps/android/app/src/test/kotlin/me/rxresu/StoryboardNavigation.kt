package me.rxresu

import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.toRoute
import java.io.File
import me.rxresu.core.data.StoryboardIds
import me.rxresu.core.navigation.*
import org.json.JSONObject
import org.junit.Assert.*

/** Raw design identity is retained so owner-approved link corrections cannot hide missing edges. */
internal data class StoryboardEdge(val source: String, val designTarget: String, val target: String, val control: String)

internal fun storyboardEdges(): List<StoryboardEdge> {
    val inventory = requireNotNull(StoryboardEdge::class.java.getResourceAsStream("/storyboard-navigation.tsv"))
        .bufferedReader().useLines { lines ->
            lines.filter { it.isNotEmpty() && !it.startsWith('#') }.map { line ->
                val fields = line.split('\t')
                require(fields.size == 4) { "Invalid edge contract: $line" }
                StoryboardEdge(fields[0], fields[1], fields[2], fields[3])
            }.toList()
        }
    val handoff = System.getenv("RR_HANDOFF_DIR")?.let(::File)
        ?: generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .map { File(it, ".agents/handoff/android-app") }.firstOrNull(File::isDirectory)
    if (handoff != null) assertEquals("Storyboard links changed; audit and refresh the edge contract", inventory, readDesignEdges(handoff))
    return inventory
}

private fun readDesignEdges(handoff: File): List<StoryboardEdge> {
    val layouts = File(handoff, "design/layout")
    require(layouts.isDirectory) { "Missing storyboard layouts: $layouts" }
    return layouts.listFiles()!!.filter { it.extension == "json" && it.name != "index.json" }.sortedBy { it.name }.flatMap { file ->
        val elements = JSONObject(file.readText()).getJSONArray("elements")
        (0 until elements.length()).mapNotNull { index ->
            val element = elements.getJSONObject(index)
            val target = element.optString("navigatesTo").takeIf(String::isNotEmpty) ?: return@mapNotNull null
            val control = element.optString("label").ifEmpty { element.optString("text") }.ifEmpty { element.optString("component") }
            StoryboardEdge(file.nameWithoutExtension, target, when {
                control == "More" -> "B19-More"
                file.nameWithoutExtension == "W2-Apply" && target == "B15-Versions" -> "B18-Preview"
                else -> target
            }, control)
        }
    }.distinctBy { listOf(it.source, it.designTarget, it.target) }
}

internal class StoryboardRoute(val route: Any, val sheet: Boolean, val assertEntry: (NavBackStackEntry, String) -> Unit)

private inline fun <reified T : Any> destination(route: T, sheet: Boolean = false) = StoryboardRoute(route, sheet) { entry, edge ->
    assertTrue("$edge destination type", entry.destination.hasRoute<T>())
    assertEquals("$edge arguments", route, entry.toRoute<T>())
    assertEquals("$edge presentation", if (sheet) "dialog" else "composable", entry.destination.navigatorName)
}

/** Explicit route values, including every design's mode/tab; the graph is registered only by appDestinations. */
internal fun storyboardRoute(id: String): StoryboardRoute {
    val resume = StoryboardIds.resume
    val application = StoryboardIds.lumen
    return when (id.substringBefore('-')) {
        "A1" -> destination(Welcome)
        "A2" -> destination(SignIn())
        "A3" -> destination(TwoStep())
        "A4" -> destination(Consent("client_id=storyboard&scope=read&state=design%2Fedge"))
        "T1", "T2" -> destination(TodayTab)
        "D1" -> destination(DocumentsTab)
        "D2" -> destination(DocumentActions(resume, DocumentKind.Resume), sheet = true)
        "D3" -> destination(NewDocument(), sheet = true)
        "D4" -> destination(Import())
        "D5" -> destination(Search())
        "D6" -> destination(Trash())
        "B1" -> destination(Builder(resume))
        "B2" -> destination(BuilderSection(resume, "experience"))
        "B3" -> destination(BuilderEntry(resume, "experience", "experience-northwind"))
        "B4" -> destination(BuilderRichText(resume, "experience", "experience-northwind"))
        "B5" -> destination(BuilderBasics(resume))
        "B6" -> destination(Builder(resume, mode = BuilderMode.Design))
        "B7" -> destination(BuilderDesign(resume, DesignPicker.Template))
        "B8" -> destination(BuilderDesign(resume, DesignPicker.Layout))
        "B9" -> destination(Builder(resume, mode = BuilderMode.Check))
        "B10" -> destination(Builder(resume, mode = BuilderMode.Check, check = CheckTab.JobMatch))
        "B11" -> destination(Builder(resume, mode = BuilderMode.Share))
        "B12" -> destination(WebPageSettings(resume))
        "B13" -> destination(Visitors(resume))
        "B14" -> destination(Download(resume, DocumentKind.Resume), sheet = true)
        "B15" -> destination(Versions(resume))
        "B16" -> destination(Assistant(resume))
        "B17" -> destination(AssistantProposals(resume, "storyboard-thread"))
        "B18" -> destination(PagePreview(resume))
        "B19" -> destination(BuilderMore(resume), sheet = true)
        "L1" -> destination(Letter(StoryboardIds.lumenLetter))
        "L2" -> destination(Letter(StoryboardIds.lumenLetter, LetterMode.Design))
        "J1" -> destination(ApplicationsTab())
        "J2" -> destination(ApplicationsTab(ApplicationsView.Board))
        "J3" -> destination(ApplicationsTab(ApplicationsView.Calendar))
        "J4" -> destination(ApplicationInsights)
        "J5" -> destination(SaveJob())
        "J6" -> destination(me.rxresu.core.navigation.Application(application))
        "J7" -> destination(MoveApplication(application), sheet = true)
        "J8" -> destination(InterviewSheet(application, StoryboardIds.interview), sheet = true)
        "W1" -> destination(ApplicationWorkspace(application, WorkspaceTab.Fit))
        "W2" -> destination(ApplicationWorkspace(application, WorkspaceTab.Apply))
        "W3" -> destination(ApplicationWorkspace(application, WorkspaceTab.Prepare))
        "W4" -> destination(ApplicationWorkspace(application, WorkspaceTab.Practise))
        "W5" -> destination(ApplicationWorkspace(application, WorkspaceTab.Messages))
        "C1" -> destination(CareerTab)
        "C2" -> destination(Coach())
        "C3" -> destination(Knowledge())
        "C4" -> destination(Story(StoryboardIds.story))
        "C5" -> destination(Knowledge(KnowledgeTab.Preferences))
        "C6" -> destination(Offers)
        "C7" -> destination(ScheduleSheet(), sheet = true)
        "S1" -> destination(Settings)
        "S2" -> destination(SettingsAccount)
        "S3" -> destination(SettingsPreferences)
        "S4" -> destination(SettingsProfile)
        "S5" -> destination(SettingsAi)
        "S6" -> destination(AiProviderSheet())
        "P1" -> destination(PublicResume("https://example.invalid/r/alex/product-designer"))
        "P2" -> destination(AtsChecker())
        else -> error("Unmapped storyboard route: $id")
    }
}
