package me.rxresu.feature.builder

import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.*
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.compose.ui.layout.onSizeChanged
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*
import me.rxresu.core.data.*
import me.rxresu.core.database.SaveStatus
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.*
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.generated.*
import me.rxresu.core.page.*
import java.io.IOException
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

/** Registers full-screen previews beside the builder's internal page hit maps. */
fun NavGraphBuilder.pagePreviewGraph(nav: NavController, motion: RrNavMotion) {
    modal<PagePreview>(motion) { entry ->
        val route = entry.toRoute<PagePreview>()
        val repositories = LocalRepositories.current
        val sharedDraft = remember(entry) {
            if (route.kind == DocumentKind.Letter) runCatching { nav.getBackStackEntry<Letter>() }.getOrNull()?.toRoute<Letter>()?.letterId == route.documentId
            else runCatching { nav.getBackStackEntry<Builder>() }.getOrNull()?.toRoute<Builder>()?.resumeId == route.documentId
        }
        val vm: PagePreviewViewModel = viewModel { PagePreviewViewModel(repositories, route, ownsDraft = !sharedDraft) }
        val state by vm.state.collectAsStateWithLifecycle()
        val previous = remember(entry) { nav.previousBackStackEntry }
        val canRestore = previous?.destination?.hasRoute<Versions>() == true && previous.toRoute<Versions>().resumeId == route.documentId
        PagePreviewScreen(state, route, { nav.popBackStack() }, { nav.navigate(Download(route.documentId, route.kind)) }, { target ->
            nav.popBackStack()
            if (route.kind == DocumentKind.Letter) nav.navigate(Letter(route.documentId)) else when (target) {
                BlockTarget.Header -> nav.navigate(BuilderBasics(route.documentId))
                is BlockTarget.Item -> nav.navigate(BuilderEntry(route.documentId, target.section, target.itemId))
                is BlockTarget.Section -> nav.navigate(BuilderSection(route.documentId, target.key))
                null -> nav.navigate(Builder(route.documentId, view = WriteView.Outline))
            }
        }, { number ->
            val owner = runCatching { nav.getBackStackEntry<Builder>() }.getOrNull()?.takeIf { it.toRoute<Builder>().resumeId == route.documentId }
            if (owner != null) {
                owner.savedStateHandle["preview-issue-number"] = number
                nav.popBackStack<Builder>(inclusive = false)
            } else {
                nav.popBackStack()
                nav.navigate(Builder(route.documentId, mode = BuilderMode.Check))
                nav.currentBackStackEntry?.savedStateHandle?.set("preview-issue-number", number)
            }
        }, vm::retry, if (canRestore) ({
            previous?.savedStateHandle?.set("preview-restore-version", route.versionId)
            nav.popBackStack()
        }) else null, { nav.navigate(if (route.kind == DocumentKind.Letter) Letter(route.documentId) else Builder(route.documentId)) })
    }
}

internal data class PagePreviewState(
    val pages: List<ImageBitmap> = emptyList(), val blocks: List<PageBlock>? = null,
    val markers: List<Pair<BlockTarget, Int>> = emptyList(), val count: Int = 1,
    val updating: Boolean = true, val offline: Boolean = false, val failed: Boolean = false,
    val locked: Boolean = false,
    val rasterIssueMarkers: List<RasterIssueMarker> = emptyList(),
)

/** Frozen requests have their own source, cache identity and metadata; refusal never falls back to the live draft. */
internal class PagePreviewViewModel(
    private val repositories: RrRepositories,
    private val route: PagePreview,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val ownsDraft: Boolean = true,
) : ViewModel() {
    private val mutable = MutableStateFlow(PagePreviewState())
    val state = mutable.asStateFlow()
    private val render = RenderDebouncer(viewModelScope)
    private val account = repositories.authSession.state.value
    private val origin = repositories.authSession.origin.value
    private var revision: String? = null
    private var loading: Job? = null
    private var closeDraft: (suspend () -> Unit)? = null
    private fun sameAccount() = account == repositories.authSession.state.value && origin == repositories.authSession.origin.value
    init {
        viewModelScope.launch {
            combine(repositories.authSession.state, repositories.authSession.origin) { _, _ -> sameAccount() }.collect { same ->
                if (!same) { render.cancel(); mutable.value = PagePreviewState(updating = false, failed = true) }
            }
        }
        load()
    }
    fun retry() { revision = null; render.cancel(); load() }
    private fun load() {
        loading?.cancel()
        loading = viewModelScope.launch {
        if (!sameAccount()) return@launch
        try {
            val versionId = route.versionId
            if (versionId != null) {
                check(route.kind == DocumentKind.Resume) // LetterVersion needs its own PageSource in :core:page.
                val version = repositories.resumes.getResumeVersion(route.documentId, versionId)
                val locked = repositories.resumes.getResume(route.documentId).isLocked
                mutable.update { it.copy(locked = locked) }
                val doc = ResumeDoc(buildJsonObject { put("data", ApiJson.encodeToJsonElement(ResumeData.serializer(), version.data)) })
                draw(PageSource.ResumeVersion(route.documentId, versionId), doc)
            } else if (route.kind == DocumentKind.Letter) {
                val handle = repositories.letters.openDraft(route.documentId)
                if (ownsDraft) closeDraft = { handle.close() }
                handle.state.collect { draft ->
                    if (!sameAccount()) return@collect
                    val letter = draft.document ?: return@collect
                    mutable.update { it.copy(locked = draft.locked || letter.isLocked, offline = draft.status == SaveStatus.Offline) }
                    if (draft.status == SaveStatus.Saving) mutable.update { it.copy(updating = true) }
                    val next = letter.revision.toString()
                    if (draft.status in setOf(SaveStatus.Saved, SaveStatus.Offline) && revision != next) {
                        revision = next
                        render.submit { draw(PageSource.Letter(route.documentId, next), null, draft.status == SaveStatus.Offline) }
                    }
                }
            } else {
                val handle = repositories.resumes.openDraft(route.documentId)
                if (ownsDraft) closeDraft = { handle.close() }
                handle.state.collect { draft ->
                    if (!sameAccount()) return@collect
                    val resume = draft.document ?: return@collect
                    mutable.update { it.copy(locked = draft.locked || resume.isLocked, offline = draft.status == SaveStatus.Offline) }
                    if (draft.status == SaveStatus.Saving) mutable.update { it.copy(updating = true) }
                    if (draft.status in setOf(SaveStatus.Saved, SaveStatus.Offline) && revision != resume.updatedAt) {
                        revision = resume.updatedAt
                        render.submit { draw(PageSource.Resume(route.documentId, resume.updatedAt), ResumeDoc(resume.toJson()), draft.status == SaveStatus.Offline) }
                    }
                }
            }
        } catch (e: CancellationException) { throw e } catch (_: Exception) { if (sameAccount()) mutable.update { it.copy(updating = false, failed = true) } }
    }
    }
    private suspend fun draw(source: PageSource, doc: ResumeDoc?, offlineHint: Boolean = false) {
        if (!sameAccount()) return
        mutable.update { it.copy(updating = true, failed = false) }
        try {
            var offline = offlineHint
            val document = try { repositories.pages.render(source) } catch (e: IOException) {
                if (e is PageHttpException || e is PageSessionChanged || e is PageSourceUnavailable) throw e
                offline = true
                repositories.pages.lastGood(source) ?: throw e
            }
            offline = offline || document.source.revision != source.revision
            val images = (0 until document.pageCount).map { repositories.pages.page(document, it, 716).asImageBitmap() }
            val blocks = if (doc == null || offline) null else withContext(io) { PdfTextReader.read(document.file)?.let { PageBlocks.build(doc, it, templateColumns(doc.template) == 2) } }
            val checks = if (doc == null || offline || route.versionId != null) null else runCatching { repositories.checks.getResumeChecks(route.documentId) }.getOrElse { if (it is CancellationException) throw it; null }
            val markers = checks?.findings.orEmpty().mapIndexedNotNull { i, finding -> doc?.let { CheckPointer.target(it, finding.pointer) }?.let { it to i + 1 } }
            if (sameAccount()) mutable.update { it.copy(pages = images, blocks = blocks, markers = markers, rasterIssueMarkers = document.rasterIssueMarkers, count = document.pageCount, updating = false, offline = offline, failed = false) }
        } catch (e: CancellationException) { throw e } catch (_: Exception) {
            if (sameAccount()) mutable.update { it.copy(pages = emptyList(), blocks = null, updating = false, failed = true) }
        }
    }
    override fun onCleared() {
        render.cancel()
        val close = closeDraft ?: return
        CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate).launch {
            try { close() } catch (_: Exception) { /* The draft owner retains unsaved content when closing refuses. */ } finally { coroutineContext.cancel() }
        }
    }
}

@Composable internal fun PagePreviewScreen(
    state: PagePreviewState, route: PagePreview, dismiss: () -> Unit, share: () -> Unit,
    edit: (BlockTarget?) -> Unit, issue: (Int) -> Unit, retry: () -> Unit,
    restore: (() -> Unit)? = null, openCurrent: () -> Unit = {},
) {
    val c = RrTheme.colors
    val zoom = remember { RrPageZoomState() }
    val haptics = rememberRrHaptics()
    val highlight = route.section?.let { key -> if (key == "basics") BlockTarget.Header else route.itemId?.let { BlockTarget.Item(key, it) } ?: BlockTarget.Section(key) }
        ?: route.issueNumber?.let { number -> state.markers.firstOrNull { it.second == number }?.first }
    val threshold = with(LocalDensity.current) { RrSpace.s16.toPx() }
    val close by rememberUpdatedState(dismiss)
    var page by remember { mutableIntStateOf(1) }
    var viewportWidth by remember { mutableIntStateOf(0) }
    val density = LocalDensity.current
    val gutter = with(density) { 16.dp.toPx() }
    CompositionLocalProvider(LocalRrColors provides c.copy(bg = c.sunken)) {
    Column(Modifier.fillMaxSize().background(c.sunken).rrNavigationBarsPadding()) {
        RrTopBar(onClose = dismiss, center = {
            if (state.updating && state.pages.isNotEmpty()) Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { RrSpinner(); RrText(stringResource(S.string.updating_preview), style = RrType.ui) }
            else RrText(stringResource(S.string.page_0_of_1, page.toString(), state.count.toString()), style = RrType.topBarTitle.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium))
        }) { RrIconButton(D.drawable.ic_ph_share_network, stringResource(S.string.share_pdf), share, enabled = route.versionId == null) }
        if (state.offline) RrOfflineStrip()
        if (state.failed) RrCallout(stringResource(S.string.couldn_t_load_try_again), tone = RrTone.Danger, actionLabel = stringResource(S.string.try_again), onAction = retry)
        Box(Modifier.weight(1f).onSizeChanged { viewportWidth = it.width }) {
            PageCanvas(state.pages, state.blocks, { index, x, y ->
                if (route.versionId == null && !state.offline && !state.updating && !state.failed) {
                    val marker = previewMarkerHit(state, index, x, y, (viewportWidth - 2 * gutter) / density.density)
                    if (marker != null) issue(marker) else edit(PageBlocks.hit(state.blocks.orEmpty(), index, x, y)?.target)
                }
            }, Modifier.pointerInput(zoom, threshold) {
                awaitEachGesture {
                    val first = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                    val eligible = zoom.scale.value <= 1.01f && zoom.y.value >= -1f
                    var distance = 0f; var single = true
                    do {
                        val event = awaitPointerEvent(PointerEventPass.Initial)
                        if (event.changes.size > 1) single = false
                        event.changes.firstOrNull { it.id == first.id }?.let { distance += it.position.y - it.previousPosition.y }
                    } while (event.changes.any { it.pressed })
                    if (single && eligible && distance > threshold) close()
                }
            }, highlight = highlight, markers = state.markers.filterNot { (_, number) -> state.rasterIssueMarkers.any { it.number == number } }, sheetCover = if (highlight != null) ({ 0f }) else null, zoom = zoom,
                onZoomChange = { scale -> if (scale == 1f || scale == RrPageZoom.DOUBLE) haptics(RrHaptic.Selection) }, pageCountHint = state.count,
                hint = if (route.versionId == null && !state.offline) stringResource(R.string.preview_gesture_hint) else null,
                rasterIssueMarkers = state.rasterIssueMarkers)
            LaunchedEffect(zoom, viewportWidth, state.count) {
                val pageHeight = (viewportWidth - 2 * gutter) / RrLayout.PAGE_ASPECT
                snapshotFlow { zoom.y.value to zoom.scale.value }.collect { (offset, scale) ->
                    page = ((-offset / scale - gutter) / (pageHeight + gutter)).toInt().plus(1).coerceIn(1, state.count)
                }
            }
        }
        if (route.versionId != null) RrFooterBar {
            if (restore != null) {
                RrButton(stringResource(S.string.back_to_now), dismiss, Modifier.weight(1f), variant = RrButtonVariant.Secondary)
                RrButton(stringResource(S.string.restore_this_version), restore, Modifier.weight(1f), enabled = !state.locked && !state.failed && !state.updating)
            } else RrButton(stringResource(S.string.open), openCurrent, Modifier.weight(1f))
        }
    }
}

}

/** Marker hit targets use the same block coordinates as PageCanvas.Marker. */
internal fun previewMarkerHit(state: PagePreviewState, page: Int, x: Float, y: Float, paperWidthDp: Float): Int? {
    if (paperWidthDp <= 0) return null
    val paperHeightDp = paperWidthDp / RrLayout.PAGE_ASPECT
    state.rasterIssueMarkers.firstOrNull { marker ->
        marker.page == page && x in (marker.x - 22f / paperWidthDp)..(marker.x + 22f / paperWidthDp) &&
            y in (marker.y - 22f / paperHeightDp)..(marker.y + 22f / paperHeightDp)
    }?.let { return it.number }
    return state.markers.firstOrNull { (target, _) ->
        state.blocks?.firstOrNull { it.target == target && it.page == page }?.let { block ->
            val centerX = block.left - 12f / paperWidthDp
            val centerY = block.top + 8f / paperHeightDp
            x in (centerX - 22f / paperWidthDp)..(centerX + 22f / paperWidthDp) &&
                y in (centerY - 22f / paperHeightDp)..(centerY + 22f / paperHeightDp)
        } == true
    }?.second
}
