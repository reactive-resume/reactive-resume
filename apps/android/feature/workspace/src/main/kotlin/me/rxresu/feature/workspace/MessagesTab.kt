// W5 · Messages: pick a kind, get a draft, edit it in place, send it from your own mail app. The app never sends email.
package me.rxresu.feature.workspace

import me.rxresu.core.navigation.SettingsAi
import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavController
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import me.rxresu.core.data.LocalRepositories
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.data.approvedFor
import me.rxresu.core.designsystem.LocalReducedMotion
import me.rxresu.core.designsystem.R as DsR
import me.rxresu.core.designsystem.RrButton
import me.rxresu.core.designsystem.RrButtonSize
import me.rxresu.core.designsystem.RrButtonVariant
import me.rxresu.core.designsystem.RrCallout
import me.rxresu.core.designsystem.RrCard
import me.rxresu.core.designsystem.RrFilterChip
import me.rxresu.core.designsystem.RrHaptic
import me.rxresu.core.designsystem.RrMotion
import me.rxresu.core.designsystem.RrText
import me.rxresu.core.designsystem.RrTextField
import me.rxresu.core.designsystem.RrTheme
import me.rxresu.core.designsystem.RrTone
import me.rxresu.core.designsystem.RrType
import me.rxresu.core.designsystem.rememberRrHaptics
import me.rxresu.core.navigation.LocalToasts
import me.rxresu.core.navigation.Offers
import me.rxresu.core.navigation.WorkspaceTab
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.AiDraftApplicationMessageRequest
import me.rxresu.core.network.generated.AiDraftApplicationMessageRequestKind
import me.rxresu.core.network.generated.CreateCareerOfferResponseDataReplyKind
import me.rxresu.core.network.generated.GenerateCareerWorkRequest
import me.rxresu.core.network.generated.GenerateCareerWorkRequestTaskReply
import me.rxresu.core.network.generated.LogApplicationReplyRequest
import me.rxresu.core.network.generated.MessageDraft
import me.rxresu.core.network.generated.PatchApplicationContactsItem
import me.rxresu.core.strings.R as S

/** The kinds the API can draft: a follow-up, or a reply to a message the employer sent. */
internal enum class MessageKind { FollowUp, Reply }

internal data class MessagesState(
    val context: WorkspaceContext,
    val kind: MessageKind = MessageKind.FollowUp,
    val followUp: String = "",
    val subject: String = "",
    val pasted: String = "",
    val reply: MessageDraft? = null,
    val drafting: Boolean = false,
    val failed: Boolean = false,
    val logging: Boolean = false,
) {
    /** The person to write to: a recruiter first, then anyone with an email. */
    val contact: PatchApplicationContactsItem? get() = context.app.contacts.let { all ->
        all.firstOrNull { it.type.equals("recruiter", true) } ?: all.firstOrNull { !it.email.isNullOrBlank() } ?: all.firstOrNull()
    }
    val body get() = if (kind == MessageKind.FollowUp) followUp else reply?.reply.orEmpty()
}

internal class MessagesViewModel(private val repos: RrRepositories, private val id: String) : ViewModel() {
    val state = MutableStateFlow<Load<MessagesState>>(Load.Loading)
    private var job: Job? = null

    init { load() }

    fun load() {
        viewModelScope.launch {
            state.value = runCatching {
                val context = repos.workspaceContext(id)
                val drafts = context.saved.filter { it.data is MessageDraft }
                val followUp = drafts.firstOrNull { (it.data as MessageDraft).message.isBlank() }
                val reply = drafts.firstOrNull { (it.data as MessageDraft).message.isNotBlank() }?.data as? MessageDraft
                MessagesState(context, followUp = (followUp?.data as? MessageDraft)?.reply.orEmpty(), subject = followUp?.title.orEmpty(), reply = reply, pasted = reply?.message.orEmpty())
            }.fold({ Load.Ready(it) }, { Load.Failed(it.isOffline()) })
        }
    }

    private fun edit(change: (MessagesState) -> MessagesState) = state.update { if (it is Load.Ready) Load.Ready(change(it.value)) else it }
    private fun ready() = (state.value as? Load.Ready)?.value

    fun select(kind: MessageKind) = edit { it.copy(kind = kind, failed = false) }
    fun editBody(text: String) = edit { s -> if (s.kind == MessageKind.FollowUp) s.copy(followUp = text) else s.copy(reply = s.reply?.copy(reply = text)) }
    fun editPasted(text: String) = edit { it.copy(pasted = text) }

    /** Drafts again; the previous draft stays in Library. A failure keeps the current words. */
    fun draft(locale: Locale) {
        val s = ready() ?: return
        val provider = s.context.provider ?: return
        if (s.drafting) return
        edit { it.copy(drafting = true, failed = false) }
        job = viewModelScope.launch {
            try {
                when (s.kind) {
                    MessageKind.FollowUp -> {
                        val text = repos.workspace.aiDraftApplicationMessage(id, AiDraftApplicationMessageRequest(AiDraftApplicationMessageRequestKind.FollowUp), RequestOptions().approvedFor(provider)).text
                        edit { it.copy(drafting = false, followUp = text) }
                    }
                    MessageKind.Reply -> {
                        val item = repos.workspace.generateCareerWork(GenerateCareerWorkRequest(id, locale.toLanguageTag(), GenerateCareerWorkRequestTaskReply(s.pasted, locale.toLanguageTag(), CreateCareerOfferResponseDataReplyKind.Reply)), RequestOptions().approvedFor(provider)).item
                        val reply = item?.data as? MessageDraft ?: error("No reply")
                        edit { it.copy(drafting = false, reply = reply) }
                    }
                }
            } catch (e: CancellationException) {
                edit { it.copy(drafting = false) }
                throw e
            } catch (e: Exception) {
                if (e.destinationChanged()) {
                    val context = repos.renewAiDisclosure(s.context)
                    edit { it.copy(context = context) }
                }
                edit { it.copy(drafting = false, failed = true) }
            }
        }
    }

    fun stop() { job?.cancel() }

    /** Records that you followed up; clears the follow-up reminder. */
    suspend fun logFollowUp(): Boolean = runCatching {
        repos.applications.logApplicationFollowUp(id)
        load()
    }.isSuccess

    /** Records that you replied, against the reply version this screen read. */
    suspend fun logReply(): Boolean = runCatching {
        val app = ready()?.context?.app ?: return false
        repos.applications.logApplicationReply(id, LogApplicationReplyRequest(app.replyVersion.orEmpty()))
        load()
    }.isSuccess
}

@Composable
internal fun MessagesTab(applicationId: String, nav: NavController) {
    val repos = LocalRepositories.current
    val vm = viewModel(key = "messages-$applicationId") { MessagesViewModel(repos, applicationId) }
    val load by vm.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val toasts = LocalToasts.current
    val haptics = rememberRrHaptics()
    val scope = rememberCoroutineScope()
    val locale = LocalConfiguration.current.locales[0]
    val copied = stringResource(S.string.reply_copied)
    val followed = stringResource(S.string.followed_up)
    val logFailed = stringResource(S.string.couldn_t_log_the_follow_up_check_the_timeline_before_trying_again)
    val replyLogged = stringResource(S.string.reply_copied_and_logged_as_replied)
    val replyNotLogged = stringResource(S.string.reply_copied_logging_wasn_t_confirmed_check_the_timeline_before_trying_again)
    Loaded(load, vm::load) { state ->
        val subject = state.subject.ifBlank { stringResource(R.string.workspace_application_subject, state.context.app.role) }
        MessagesScreen(
            state,
            subject = subject,
            onKind = vm::select,
            onBody = vm::editBody,
            onPasted = vm::editPasted,
            onDraft = { vm.draft(locale) },
            onStop = vm::stop,
            onCopy = {
                context.copyToClipboard(subject, state.body)
                haptics(RrHaptic.Success)
                scope.launch { toasts.show(copied) }
            },
            onMail = {
                val to = state.contact?.email.orEmpty()
                val uri = ("mailto:" + Uri.encode(to) + "?subject=" + Uri.encode(subject) + "&body=" + Uri.encode(state.body)).toUri()
                runCatching { context.startActivity(Intent(Intent.ACTION_SENDTO, uri)) }
            },
            onAddContact = { nav.openTab(applicationId, WorkspaceTab.Overview) },
            onOffers = { nav.navigate(Offers) },
            onLogFollowUp = {
                scope.launch {
                    if (vm.logFollowUp()) { haptics(RrHaptic.Success); toasts.show(followed) } else toasts.show(logFailed)
                }
            },
            onCopyAndLogReply = {
                context.copyToClipboard(subject, state.body)
                scope.launch {
                    if (vm.logReply()) { haptics(RrHaptic.Success); toasts.show(replyLogged) } else toasts.show(replyNotLogged)
                }
            },
            onSetUpAi = { nav.navigate(SettingsAi) },
        )
    }
}

@Composable
internal fun MessagesScreen(
    state: MessagesState,
    subject: String,
    onKind: (MessageKind) -> Unit,
    onBody: (String) -> Unit,
    onPasted: (String) -> Unit,
    onDraft: () -> Unit,
    onStop: () -> Unit,
    onCopy: () -> Unit,
    onMail: () -> Unit,
    onAddContact: () -> Unit,
    onOffers: () -> Unit,
    onLogFollowUp: () -> Unit,
    onCopyAndLogReply: () -> Unit,
    onSetUpAi: () -> Unit = {},
) {
    val c = RrTheme.colors
    val provider = state.context.provider
    val hasDraft = state.body.isNotBlank()
    TabBody(
        footer = when {
            state.kind == MessageKind.FollowUp -> { { RrButton(stringResource(R.string.workspace_log_follow_up), onLogFollowUp, Modifier.fillMaxWidth(), size = RrButtonSize.Large, icon = DsR.drawable.ic_ph_check) } }
            hasDraft -> { { RrButton(stringResource(S.string.copy_and_log_as_replied), onCopyAndLogReply, Modifier.fillMaxWidth(), size = RrButtonSize.Large, icon = DsR.drawable.ic_ph_check) } }
            else -> null
        },
    ) {
        AiDestinationNotice(state.context)
        Column(Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                RrFilterChip(stringResource(S.string.follow_up_2a747118b4), state.kind == MessageKind.FollowUp, { onKind(MessageKind.FollowUp) })
                RrFilterChip(stringResource(S.string.reply), state.kind == MessageKind.Reply, { onKind(MessageKind.Reply) })
            }
            if (state.kind == MessageKind.Reply && state.reply == null) {
                RrTextField(state.pasted, onPasted, label = stringResource(S.string.paste_a_message_from_company, state.context.app.company), helper = stringResource(S.string.paste_the_email_or_message_without_the_signature), singleLine = false, minLines = 5)
            }
            if (hasDraft) {
                val reduced = LocalReducedMotion.current
                RrCard(raised = true) {
                    Field(stringResource(R.string.workspace_to)) {
                        val contact = state.contact
                        if (contact == null) RrText(stringResource(R.string.workspace_add_a_contact), Modifier.clickable(role = Role.Button, onClick = onAddContact), style = RrType.ui, color = c.accentText)
                        else RrText(listOfNotNull(contact.name, contact.role?.takeIf { it.isNotBlank() }).joinToString(" · "), style = RrType.ui, color = c.ink)
                    }
                    Spacer(Modifier.fillMaxWidth().height(1.dp).background(c.line))
                    Field(stringResource(R.string.workspace_subject)) { RrText(subject, style = RrType.ui, color = c.ink) }
                    Spacer(Modifier.fillMaxWidth().height(1.dp).background(c.line))
                    if (state.kind == MessageKind.Reply) RrText(stringResource(S.string.suggested_reply_edit_before_sending), style = RrType.caption, color = c.ink3)
                    // Redraft fades the body out while drafting and the new words in (d2).
                    val fade by animateFloatAsState(if (state.drafting) 0.4f else 1f, RrMotion.spec(RrMotion.D2, reduced), label = "draft")
                    val label = stringResource(R.string.workspace_message_body)
                    BasicTextField(
                        state.body,
                        onBody,
                        Modifier.fillMaxWidth().graphicsLayer { alpha = fade }.semantics { contentDescription = label },
                        textStyle = RrType.body.copy(color = c.ink),
                        cursorBrush = SolidColor(c.accent),
                    )
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    RrButton(stringResource(S.string.copy), onCopy, variant = RrButtonVariant.Secondary, icon = DsR.drawable.ic_ph_copy)
                    RrButton(stringResource(R.string.workspace_open_in_mail), onMail, variant = RrButtonVariant.Secondary, icon = DsR.drawable.ic_ph_envelope_simple)
                    if (provider != null && !state.drafting) RrButton(stringResource(R.string.workspace_redraft), onDraft, variant = RrButtonVariant.Ghost, icon = DsR.drawable.ic_ph_sparkle, iconTint = c.accentText)
                }
                state.reply?.offer?.takeIf { state.kind == MessageKind.Reply }?.let {
                    RrCallout(stringResource(S.string.no_terms_were_extracted_opens_in_career_offers), title = stringResource(S.string.save_these_offer_terms_to_compare), actionLabel = stringResource(S.string.open_in_offers), onAction = onOffers)
                }
            }
            when {
                state.drafting -> Working(if (state.kind == MessageKind.Reply) listOf(S.string.reading_the_message, S.string.spotting_what_changed, S.string.drafting_a_reply) else listOf(S.string.drafting), onStop)
                provider == null -> RrCallout(stringResource(S.string.connect_an_ai_provider), actionLabel = stringResource(S.string.set_up_ai), onAction = onSetUpAi)
                !hasDraft -> RrButton(
                    stringResource(if (state.kind == MessageKind.Reply) S.string.read_it_for_me else R.string.workspace_draft_follow_up),
                    onDraft,
                    icon = DsR.drawable.ic_ph_sparkle,
                    enabled = state.kind == MessageKind.FollowUp || state.pasted.isNotBlank(),
                )
            }
            if (state.failed) RrCallout(stringResource(S.string.couldn_t_complete_this_action_try_again), tone = RrTone.Danger)
        }
    }
}

@Composable
private fun Field(label: String, value: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        RrText(label, style = RrType.small, color = RrTheme.colors.ink3)
        Column(Modifier.weight(1f)) { value() }
    }
}
