package me.rxresu.feature.settings

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.network.generated.CreateAiProviderRequestProvider as Provider
import me.rxresu.core.strings.R as CR

@Composable
internal fun AiScreen(
    s: SettingsState,
    back: () -> Unit = {},
    edit: (String?) -> Unit = {},
    reload: () -> Unit = {},
    browser: (String) -> Unit = {},
    server: String = "https://rxresu.me",
    developer: (String) -> Unit = {},
) {
    SettingsFrame(stringResource(CR.string.ai_developer), back) {
        RrSectionHeader(
            stringResource(CR.string.ai_providers),
            actionLabel = stringResource(CR.string.add_ai_provider),
            onAction = { edit(null) },
        )
        if (s.providersLoading) RrSkeletonText(Modifier.padding(16.dp), lines = 3)
        if (s.providerError)
            RrCallout(
                stringResource(CR.string.ai_providers_couldn_t_be_loaded_reload_to_try_again),
                Modifier.padding(16.dp),
                tone = RrTone.Danger,
                actionLabel = stringResource(R.string.screen_reload),
                onAction = reload,
            )
        else if (!s.providersLoading && s.providers.isEmpty())
            RrCallout(
                stringResource(R.string.screen_not_set_up),
                Modifier.padding(horizontal = 16.dp),
            )
        if (s.providers.isNotEmpty())
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                s.providers.forEach { p ->
                    RrListRow(
                        p.label,
                        subtitle =
                            if (p.managed) stringResource(CR.string.managed_by_your_server)
                            else
                                p.model +
                                    if (p.isDefault)
                                        " · " + stringResource(CR.string.message_default)
                                    else "",
                        icon =
                            if (p.provider == Provider.Ollama) D.drawable.ic_ph_desktop
                            else D.drawable.ic_ph_sparkle,
                        onClick = { edit(p.id) },
                        trailing = {
                            RrBadge(
                                when (p.testStatus) {
                                    "success" -> stringResource(R.string.screen_connected)
                                    "failure" -> stringResource(CR.string.failed)
                                    else -> stringResource(R.string.screen_not_tested)
                                },
                                tone =
                                    when (p.testStatus) {
                                        "success" -> RrBadgeTone.Accent
                                        "failure" -> RrBadgeTone.Danger
                                        else -> RrBadgeTone.Neutral
                                    },
                            )
                        },
                    )
                }
            }
        RrCallout(
            stringResource(
                CR.string.your_provider_may_charge_your_account_for_requests_made_with_your_api_key
            ),
            Modifier.padding(start = 16.dp, end = 16.dp, top = 10.dp),
            tone = RrTone.Warn,
            icon = D.drawable.ic_ph_key,
        )
        RrSectionHeader(stringResource(R.string.screen_assistant_and_coach))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            NavRow(stringResource(CR.string.web_access), null, D.drawable.ic_ph_globe_simple) {
                developer("web")
            }
            NavRow(
                stringResource(CR.string.remember_facts_from_my_messages),
                null,
                D.drawable.ic_ph_book_open,
            ) {
                developer("memory")
            }
            NavRow(stringResource(R.string.screen_usage), null, D.drawable.ic_ph_chart_bar) {
                developer("usage")
            }
        }
        RrSectionHeader(stringResource(R.string.screen_developer))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            NavRow(
                stringResource(CR.string.mcp_server),
                stringResource(R.string.screen_sign_in_from_your_ai_client_or_use_an_api_key),
                D.drawable.ic_ph_plugs_connected,
            ) {
                developer("mcp")
            }
            NavRow(stringResource(CR.string.api_keys), null, D.drawable.ic_ph_key) {
                developer("keys")
            }
            NavRow(
                stringResource(CR.string.connected_applications),
                null,
                D.drawable.ic_ph_desktop,
            ) {
                developer("applications")
            }
        }
    }
}

@Composable
internal fun ProviderScreen(
    s: ProviderState,
    edit: ((ProviderState) -> ProviderState) -> Unit = {},
    choose: (Provider) -> Unit = {},
    save: () -> Unit = {},
    test: () -> Unit = {},
    makeDefault: () -> Unit = {},
    delete: () -> Unit = {},
    close: () -> Unit = {},
    browser: (String) -> Unit = {},
) {
    var more by remember { mutableStateOf(false) }
    var tasks by remember { mutableStateOf(false) }
    var modelEditor by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    val haptic = rememberRrHaptics()
    val managed = s.original?.managed == true
    LaunchedEffect(s.testCount, s.error) {
        when {
            s.error || (s.testCount > 0 && s.testStatus == "failure") -> haptic(RrHaptic.Error)
            s.testCount > 0 && s.testStatus == "success" -> haptic(RrHaptic.Success)
        }
    }
    RrBottomSheet(
        close,
        title = if (s.original == null) stringResource(CR.string.add_ai_provider) else s.label,
        detents = RrSheetDetents.Full,
        confirmDiscard = s.dirty,
        footer = {
            if (!managed)
                Row(
                    Modifier.fillMaxWidth().padding(16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    RrButton(
                        if (s.original == null || s.dirty)
                            stringResource(R.string.screen_save_and_test_connection)
                        else stringResource(CR.string.test_connection),
                        test,
                        Modifier.weight(1f),
                        variant = RrButtonVariant.Secondary,
                        size = RrButtonSize.Large,
                        loading = s.busy,
                    )
                    RrButton(
                        stringResource(R.string.screen_save_provider),
                        save,
                        Modifier.weight(1f),
                        size = RrButtonSize.Large,
                        enabled =
                            !s.busy &&
                                s.original != null &&
                                (!s.isNew || s.testStatus == "success"),
                    )
                }
        },
    ) {
        Column(
            Modifier.fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (s.loading) RrSkeletonText(lines = 5)
            else if (managed) {
                RrCallout(stringResource(CR.string.managed_by_your_server))
                RrText(s.model, style = RrType.mono)
            } else {
                val initial =
                    listOf(
                        Provider.Openai,
                        Provider.Anthropic,
                        Provider.Gemini,
                        Provider.Openrouter,
                        Provider.Mistral,
                        Provider.Ollama,
                        Provider.Groq,
                        Provider.Deepseek,
                    )
                val providers = if (more) providerNames.keys.toList() else initial
                (providers.map { it as Provider? } + if (more) emptyList() else listOf(null))
                    .chunked(3)
                    .forEach { row ->
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            row.forEach { provider ->
                                RrButton(
                                    provider?.let { providerNames.getValue(it) }
                                        ?: stringResource(R.string.screen_more),
                                    {
                                        if (provider == null) more = true
                                        else {
                                            haptic(RrHaptic.Selection)
                                            choose(provider)
                                        }
                                    },
                                    Modifier.weight(1f)
                                        .heightIn(min = 44.dp)
                                        .then(
                                            if (provider == s.provider)
                                                Modifier.border(
                                                    1.dp,
                                                    RrTheme.colors.accent,
                                                    RrShape.md,
                                                )
                                            else Modifier
                                        ),
                                    variant =
                                        if (provider == s.provider) RrButtonVariant.Soft
                                        else RrButtonVariant.Secondary,
                                    size = RrButtonSize.Small,
                                    enabled = !s.busy,
                                )
                            }
                            repeat(3 - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                RrTextField(
                    s.label,
                    { v -> edit { it.copy(label = v) } },
                    label = stringResource(CR.string.name),
                    enabled = !s.busy,
                )
                RrTextField(
                    s.key,
                    { v -> edit { it.copy(key = v) } },
                    label = stringResource(CR.string.api_key),
                    enabled = !s.busy,
                    helper =
                        if (s.original != null)
                            stringResource(CR.string.leave_empty_to_keep_the_saved_key)
                        else if (s.provider == Provider.Ollama)
                            stringResource(CR.string.optional_for_local_ollama)
                        else stringResource(R.string.screen_stored_encrypted_on_your_server),
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions =
                        KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            autoCorrectEnabled = false,
                        ),
                    leadingIcon = D.drawable.ic_ph_lock_simple,
                )
                providerKeyUrls[s.provider]
                    ?.takeIf { it.isNotEmpty() }
                    ?.let { url ->
                        RrButton(
                            stringResource(CR.string.get_an_api_key),
                            { browser(url) },
                            variant = RrButtonVariant.GhostAccent,
                        )
                    }
                Crossfade(
                    s.provider,
                    animationSpec = tween(if (RrTheme.reducedMotion) RrMotion.D1 else RrMotion.D2),
                    label = "provider fields",
                ) { type ->
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        RrListRow(
                            stringResource(CR.string.model),
                            subtitle =
                                stringResource(R.string.screen_recommended_for_this_provider),
                            onClick = { modelEditor = true },
                            trailing = {
                                RrButton(
                                    stringResource(CR.string.choose_model),
                                    { modelEditor = true },
                                    variant = RrButtonVariant.Secondary,
                                    size = RrButtonSize.Small,
                                )
                            },
                        )
                        if (type in listOf(Provider.Ollama, Provider.OpenaiCompatible) || tasks)
                            RrTextField(
                                s.baseURL,
                                { v -> edit { it.copy(baseURL = v) } },
                                label = stringResource(CR.string.base_url),
                                mono = true,
                                ltr = true,
                                enabled = !s.busy,
                            )
                    }
                }
                RrListRow(
                    stringResource(CR.string.task_models_optional),
                    subtitle = stringResource(R.string.screen_fast_model_capable_model),
                    onClick = { tasks = !tasks },
                    trailing = { RrRowCaret() },
                )
                if (tasks) {
                    RrTextField(
                        s.fastModel,
                        { v -> edit { it.copy(fastModel = v) } },
                        label = stringResource(CR.string.fast_model),
                        enabled = !s.busy,
                    )
                    RrTextField(
                        s.capableModel,
                        { v -> edit { it.copy(capableModel = v) } },
                        label = stringResource(CR.string.capable_model),
                        enabled = !s.busy,
                    )
                }
                RrCallout(
                    stringResource(
                        CR.string
                            .your_provider_may_charge_your_account_for_requests_made_with_your_api_key
                    ),
                    tone = RrTone.Warn,
                    icon = D.drawable.ic_ph_key,
                )
                if (s.error) ErrorCallout()
                s.problem?.let { problem ->
                    RrCallout(
                        when (problem) {
                            "name" -> stringResource(R.string.screen_name_is_required)
                            "url" -> stringResource(CR.string.enter_an_http_or_https_base_url)
                            "key" -> stringResource(CR.string.enter_an_api_key_for_this_provider)
                            "recipient" ->
                                stringResource(
                                    CR.string
                                        .the_saved_key_isn_t_sent_to_a_new_base_url_enter_it_again
                                )
                            else -> stringResource(CR.string.enter_a_model_id)
                        },
                        tone = RrTone.Danger,
                    )
                }
                Crossfade(
                    s.testStatus,
                    animationSpec = tween(RrMotion.D1),
                    label = "test status",
                ) { result ->
                    if (result == "success")
                        RrCallout(stringResource(R.string.screen_connected), tone = RrTone.Accent)
                    else if (result == "failure")
                        RrCallout(providerError(s.testErrorKind), tone = RrTone.Danger)
                }
                if (s.original != null) {
                    RrButton(
                        stringResource(CR.string.make_default),
                        makeDefault,
                        variant = RrButtonVariant.Secondary,
                        enabled =
                            !s.busy &&
                                !s.dirty &&
                                s.original.testStatus == "success" &&
                                !s.original.isDefault,
                    )
                    RrButton(
                        stringResource(CR.string.delete_provider),
                        { deleting = true },
                        variant = RrButtonVariant.DangerGhost,
                        enabled = !s.busy,
                    )
                }
            }
        }
    }
    if (modelEditor)
        RrBottomSheet({ modelEditor = false }, title = stringResource(CR.string.model)) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                RrTextField(
                    s.model,
                    { v -> edit { it.copy(model = v) } },
                    label = stringResource(CR.string.model),
                    mono = true,
                )
                RrButton(
                    stringResource(R.string.screen_recommended_for_this_provider),
                    { edit { it.copy(model = providerDefaults.getValue(s.provider).first) } },
                    variant = RrButtonVariant.Secondary,
                )
                RrButton(
                    stringResource(CR.string.done),
                    { modelEditor = false },
                    Modifier.fillMaxWidth(),
                )
            }
        }
    if (deleting)
        RrAlertDialog(
            stringResource(CR.string.delete_provider),
            stringResource(R.string.screen_its_saved_key_is_deleted),
            stringResource(CR.string.hold_to_delete),
            {
                deleting = false
                delete()
            },
            { deleting = false },
            confirm = RrDialogConfirm.HoldToDelete,
        )
}

@Composable
private fun providerError(kind: String?): String =
    when (kind) {
        "auth" -> stringResource(CR.string.the_key_was_rejected_check_the_key_and_test_again)
        "model" ->
            stringResource(
                CR.string
                    .the_model_wasn_t_available_or_couldn_t_complete_the_test_check_its_name_or_try_another_model
            )
        "network" ->
            stringResource(
                CR.string
                    .the_service_couldn_t_be_reached_check_the_address_and_connection_then_try_again
            )
        "url" -> stringResource(CR.string.enter_the_api_base_url_of_your_service_and_test_again)
        "rate-limit" ->
            stringResource(
                CR.string
                    .the_provider_limited_this_request_wait_and_try_again_check_your_account_quota
            )
        "server" -> stringResource(CR.string.the_provider_reported_a_server_error_try_again_later)
        else ->
            stringResource(
                CR.string.the_connection_test_failed_check_the_key_model_and_address_then_try_again
            )
    }
