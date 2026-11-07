package me.rxresu.feature.builder

import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import coil3.compose.AsyncImage
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.designsystem.RrBottomSheet
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrIcon
import me.rxresu.core.designsystem.RrIconButton
import me.rxresu.core.designsystem.RrListGroup
import me.rxresu.core.designsystem.RrListRow
import me.rxresu.core.designsystem.RrMenuItem
import me.rxresu.core.designsystem.RrSegment
import me.rxresu.core.designsystem.RrSegmentedControl
import me.rxresu.core.designsystem.RrShape
import me.rxresu.core.designsystem.RrSlider
import me.rxresu.core.designsystem.RrSpinner
import me.rxresu.core.designsystem.RrStrip
import me.rxresu.core.designsystem.RrSwitchRow
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrTopBar
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.strings.R as S
import me.rxresu.core.designsystem.R as D

@Composable
internal fun BasicsRoute(vm: BuilderViewModel, nav: NavController) {
    val state by vm.state.collectAsStateWithLifecycle()
    val origin = LocalRepositories.current.authSession.origin.collectAsStateWithLifecycle().value
    BasicsScreen(state, vm, onBack = { vm.flush(); nav.popBackStack() }, photoOrigin = origin)
}

/** The web's email hints after the first blur (fields.tsx). */
internal fun emailProblem(email: String): Pair<Int, String?>? {
    val e = email.trim()
    if (e.isEmpty()) return null
    val at = e.indexOf('@')
    if (at < 0) return S.string.add_an_and_the_domain_like_name_example_com to null
    val domain = e.substring(at + 1)
    if (domain.isEmpty()) return S.string.add_the_domain_after_the_like_name_example_com to e.substring(0, at)
    if (!domain.contains('.') || domain.endsWith('.')) return S.string.add_the_domain_ending_like_domain_com to domain.trimEnd('.')
    return null
}

/** B5: name, contact fields, links and the photo. A full screen because it's the longest form. */
@Composable
internal fun BasicsScreen(state: BuilderUiState, actions: BuilderActions, onBack: () -> Unit, photoOrigin: String = "") {
    val doc = state.doc ?: return
    val c = RrTheme.colors
    val basics = doc.basics
    val locked = state.locked
    val write = { key: String, value: String -> actions.set(listOf("data", "basics", key), JsonPrimitive(value)) }
    var emailTouched by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(c.bg)) {
        RrTopBar(stringResource(S.string.basics), onBack = onBack, status = { RrText(doc.name) })
        if (locked) RrStrip(stringResource(S.string.locked_unlock_to_edit), tone = RrTone.Warn, icon = D.drawable.ic_ph_lock_simple)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            PhotoRow(state, doc, actions, photoOrigin)
            TextField(stringResource(S.string.full_name), basics["name"].str(), locked, actions = actions) { write("name", it) }
            TextField(stringResource(S.string.headline), basics["headline"].str(), locked, actions = actions) { write("headline", it) }
            val email = basics["email"].str()
            val problem = if (emailTouched) emailProblem(email) else null
            TextField(
                stringResource(S.string.email), email, locked, keyboard = KeyboardType.Email, ltr = true, actions = actions,
                error = problem?.let { (id, arg) -> if (arg == null) stringResource(id) else stringResource(id, arg) },
            ) { emailTouched = true; write("email", it) }
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                TextField(stringResource(S.string.phone), basics["phone"].str(), locked, keyboard = KeyboardType.Phone, ltr = true, modifier = Modifier.weight(1f), actions = actions) { write("phone", it) }
                TextField(stringResource(S.string.location), basics["location"].str(), locked, modifier = Modifier.weight(1f), actions = actions) { write("location", it) }
            }
            val website = basics["website"].obj()
            TextField(stringResource(S.string.website), website["label"].str().ifBlank { website["url"].str() }, locked, keyboard = KeyboardType.Uri, ltr = true, actions = actions) { value ->
                actions.edit { json ->
                    val url = if (value.isBlank() || Regex("^[a-zA-Z][a-zA-Z0-9+.-]*:").containsMatchIn(value)) value else "https://$value"
                    json.set(listOf("data", "basics", "website"), JsonObject(website + mapOf("url" to JsonPrimitive(url), "label" to JsonPrimitive(value)))) as JsonObject
                }
            }
            Links(doc, actions, locked)
        }
    }
}

@Composable
private fun PhotoRow(state: BuilderUiState, doc: ResumeDoc, actions: BuilderActions, origin: String) {
    val c = RrTheme.colors
    val haptics = rememberRrHaptics()
    val picture = doc.data["picture"].obj()
    val url = picture["url"].str()
    val hidden = picture["hidden"].bool()
    var change by remember { mutableStateOf(false) }
    var options by remember { mutableStateOf(false) }
    var pasting by remember { mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri: Uri? -> uri?.let(actions::uploadPhoto) }
    val camera = rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap: Bitmap? -> bitmap?.let { actions.uploadCameraPhoto(it) } }
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(72.dp).clip(RrShape.xs).background(c.sunken), contentAlignment = Alignment.Center) {
            if (url.isNotBlank()) AsyncImage(if (url.startsWith("/")) origin.trimEnd('/') + url else url, stringResource(S.string.photo), Modifier.fillMaxSize(), contentScale = ContentScale.Crop)
            else RrIcon(D.drawable.ic_ph_user, null, size = 32.dp, tint = c.ink3)
            if (state.photoUploading) Box(Modifier.fillMaxSize().background(c.scrim), contentAlignment = Alignment.Center) { RrSpinner(tint = me.rxresu.core.designsystem.RrFixedColors.paper) }
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RrText(
                stringResource(
                    when {
                        state.photoUploading -> S.string.uploading_photo
                        url.isBlank() -> S.string.no_photo_most_ats_ignore_photos_some_regions_expect_one
                        hidden -> S.string.photo_hidden_from_the_page
                        else -> S.string.photo_on_the_page
                    },
                ),
                color = c.ink2,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RrButton(stringResource(S.string.change), { change = true }, variant = RrButtonVariant.Secondary, size = me.rxresu.core.designsystem.RrButtonSize.Small, icon = D.drawable.ic_ph_camera, enabled = !state.locked && !state.photoUploading)
                if (url.isNotBlank()) RrButton(stringResource(R.string.builder_photo_options), { options = true }, variant = RrButtonVariant.Ghost, size = me.rxresu.core.designsystem.RrButtonSize.Small, enabled = !state.locked)
            }
        }
    }
    if (change) RrBottomSheet(onDismissRequest = { change = false }, fitContent = true, title = stringResource(S.string.photo)) {
        RrMenuItem(stringResource(S.string.take_photo), { change = false; camera.launch(null) }, icon = D.drawable.ic_ph_camera)
        RrMenuItem(stringResource(S.string.choose_from_library), { change = false; pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, icon = D.drawable.ic_ph_file_arrow_up)
        RrMenuItem(stringResource(R.string.builder_paste_url), { change = false; pasting = true }, icon = D.drawable.ic_ph_link_simple)
        if (url.isNotBlank()) RrMenuItem(stringResource(S.string.remove_photo), { change = false; haptics(RrHaptic.Light); actions.removePhoto() }, icon = D.drawable.ic_ph_trash, danger = true)
    }
    if (pasting) {
        var text by rememberSaveable { mutableStateOf("") }
        RrBottomSheet(onDismissRequest = { pasting = false }, fitContent = true, title = stringResource(S.string.url)) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                RrTextField(text, { text = it }, Modifier.fillMaxWidth(), placeholder = "https://", ltr = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri))
                RrButton(stringResource(S.string.done), {
                    pasting = false
                    actions.edit { it.set(listOf("data", "picture", "url"), JsonPrimitive(text.trim())).set(listOf("data", "picture", "hidden"), JsonPrimitive(false)) as JsonObject }
                }, enabled = text.isNotBlank())
            }
        }
    }
    if (options) RrBottomSheet(onDismissRequest = { options = false }, title = stringResource(R.string.builder_photo_options)) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            RrSwitchRow(stringResource(S.string.show_photo), !hidden, { actions.set(listOf("data", "picture", "hidden"), JsonPrimitive(!it)) })
            val size = (picture["size"].num() ?: 64.0).toFloat()
            Column {
                RrText(stringResource(S.string.size) + " · ${size.toInt()} pt", style = RrType.fieldLabel, color = c.ink2)
                RrSlider(size, { actions.set(listOf("data", "picture", "size"), JsonPrimitive(it.toInt())) }, Modifier.fillMaxWidth(), 32f..512f, valueDescription = "${size.toInt()} pt")
            }
            val ratios = listOf(1.0 to S.string.square, 1.5 to S.string.landscape, 0.5 to S.string.portrait)
            RrText(stringResource(S.string.aspect_ratio), style = RrType.fieldLabel, color = c.ink2)
            RrSegmentedControl(ratios.map { RrSegment(stringResource(it.second)) }, ratios.indexOfFirst { it.first == picture["aspectRatio"].num() }.coerceAtLeast(0), {
                haptics(RrHaptic.Selection); actions.set(listOf("data", "picture", "aspectRatio"), JsonPrimitive(ratios[it].first))
            })
            val radii = listOf(0, 10, 100)
            RrText(stringResource(S.string.border_radius), style = RrType.fieldLabel, color = c.ink2)
            RrSegmentedControl(radii.map { RrSegment("$it") }, radii.indexOfFirst { it.toDouble() == picture["borderRadius"].num() }.coerceAtLeast(0), {
                haptics(RrHaptic.Selection); actions.set(listOf("data", "picture", "borderRadius"), JsonPrimitive(radii[it]))
            })
        }
    }
}

/** Custom fields ("Links"): icon from the network, text, reorder by handle (or Move up), remove with Undo. */
@Composable
private fun Links(doc: ResumeDoc, actions: BuilderActions, locked: Boolean) {
    val c = RrTheme.colors
    val fields = doc.basics["customFields"].arr().map { it.obj() }
    var editing by remember { mutableStateOf<String?>(null) }
    val path = listOf("data", "basics", "customFields")
    fun rewrite(next: List<JsonObject>, toast: BuilderToast? = null) = actions.edit(toast) { it.set(path, JsonArray(next)) as JsonObject }
    if (fields.isNotEmpty()) {
        RrText(stringResource(S.string.links), style = RrType.fieldLabel, color = c.ink2)
        RrListGroup {
            ReorderColumn(fields, key = { it["id"].str() }, enabled = !locked, onMove = { from, to -> rewrite(fields.moved(from, to)) }, onActions = { editing = it["id"].str() }) { field, _ ->
                val id = field["id"].str()
                val index = fields.indexOf(field)
                val moveUp = stringResource(S.string.move_field_up)
                RrListRow(
                    field["text"].str().ifBlank { stringResource(S.string.field_0, "${index + 1}") },
                    modifier = Modifier.semantics { if (index > 0) customActions = listOf(CustomAccessibilityAction(moveUp) { rewrite(fields.moved(index, index - 1)); true }) },
                    leading = {
                        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            RrIcon(D.drawable.ic_ph_dots_six_vertical, null, tint = c.ink3)
                            RrIcon(networkIcon(field["icon"].str(), field["link"].str()), null)
                        }
                    },
                    onClick = { editing = id },
                    enabled = !locked,
                    trailing = { RrIconButton(D.drawable.ic_ph_minus, stringResource(S.string.remove_field), { rewrite(fields - field, BuilderToast(S.string.remove_field, undo = true)) }, enabled = !locked) },
                )
            }
        }
    }
    RrButton(stringResource(S.string.add_field), {
        val id = newId()
        rewrite(fields + JsonObject(mapOf("id" to JsonPrimitive(id), "icon" to JsonPrimitive("acorn"), "text" to JsonPrimitive(""), "link" to JsonPrimitive(""))))
        editing = id
    }, variant = RrButtonVariant.Secondary, icon = D.drawable.ic_ph_plus, enabled = !locked)
    editing?.let { id ->
        val field = fields.firstOrNull { it["id"].str() == id } ?: return@let
        val index = fields.indexOf(field)
        RrBottomSheet(onDismissRequest = { editing = null }, fitContent = true, title = stringResource(S.string.field_0, "${index + 1}")) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                fun update(key: String, value: String) = rewrite(fields.map { if (it["id"].str() == id) JsonObject(it + (key to JsonPrimitive(value))) else it })
                TextField(stringResource(S.string.text), field["text"].str(), locked, actions = actions) { update("text", it) }
                TextField(stringResource(S.string.link_address), field["link"].str(), locked, keyboard = KeyboardType.Uri, ltr = true, actions = actions) { update("link", it) }
                RrButton(stringResource(S.string.done), { editing = null })
            }
        }
    }
}

/** The network's icon for a link (LinkedIn, GitHub), else a globe. */
private fun networkIcon(icon: String, link: String): Int = when {
    icon.contains("linkedin") || link.contains("linkedin.") -> D.drawable.ic_ph_linkedin_logo
    icon.contains("github") || link.contains("github.") -> D.drawable.ic_ph_github_logo
    else -> D.drawable.ic_ph_globe_simple
}
