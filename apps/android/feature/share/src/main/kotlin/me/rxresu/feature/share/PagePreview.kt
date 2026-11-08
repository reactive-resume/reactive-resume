package me.rxresu.feature.share

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavController
import kotlinx.coroutines.CancellationException
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.*
import me.rxresu.core.navigation.DocumentKind
import me.rxresu.core.navigation.Download
import me.rxresu.core.navigation.PagePreview
import me.rxresu.core.page.PageSource
import java.io.IOException
import me.rxresu.core.strings.R as S

/** Full-screen page owner; frozen-version requests never substitute the live resume. */
@Composable
internal fun PagePreviewRoute(route: PagePreview, nav: NavController) {
    val repositories = LocalRepositories.current
    var attempt by remember { mutableIntStateOf(0) }
    var failed by remember(route, attempt) { mutableStateOf(false) }
    val pages by produceState<List<ImageBitmap>>(emptyList(), route, repositories, attempt) {
        try {
            val version = route.versionId
            val source = when {
                version != null -> PageSource.ResumeVersion(route.documentId, version)
                route.kind == DocumentKind.Letter -> PageSource.Letter(route.documentId, repositories.letters.getCoverLetter(route.documentId).updatedAt)
                else -> PageSource.Resume(route.documentId, repositories.resumes.getResume(route.documentId).updatedAt)
            }
            val document = try { repositories.pages.render(source) } catch (offline: IOException) {
                repositories.pages.lastGood(source) ?: throw offline
            }
            value = (0 until document.pageCount).map { repositories.pages.page(document, it, 716).asImageBitmap() }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (_: Exception) {
            failed = true
        }
    }
    Column(Modifier.fillMaxSize().rrNavigationBarsPadding()) {
        RrTopBar(onClose = { nav.popBackStack() }, actions = {
            RrIconButton(me.rxresu.core.designsystem.R.drawable.ic_ph_share_network, stringResource(S.string.share), {
                nav.navigate(Download(route.documentId, route.kind))
            })
        })
        if (failed) RrButton(stringResource(S.string.try_again), { attempt++ })
        else RrPageCanvas(pages, onTap = { _, _, _ -> }, modifier = Modifier.weight(1f))
    }
}
