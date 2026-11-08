package me.rxresu.feature.settings

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
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
    nextSteps: @Composable () -> Unit = {},
    developer: (String) -> Unit = {},
) {
    SettingsFrame(
        stringResource(R.string.v2_ai_developer),
        back,
        actions = {
            RrIconButton(
                D.drawable.ic_ph_plus,
                stringResource(CR.string.add_ai_provider),
                { edit(null) },
            )
        },
    ) {
        RrSectionHeading(stringResource(R.string.v2_providers), first = true)
        if (s.providersLoading) RrSkeletonText(Modifier.padding(24.dp), lines = 3)
        if (s.providerError)
            RrCallout(
                stringResource(CR.string.ai_providers_couldn_t_be_loaded_reload_to_try_again),
                Modifier.padding(24.dp),
                tone = RrTone.Danger,
                actionLabel = stringResource(R.string.screen_reload),
                onAction = reload,
            )
        else if (!s.providersLoading && s.providers.isEmpty())
            RrText(
                stringResource(R.string.screen_not_set_up),
                Modifier.padding(24.dp),
                style = RrType.ui,
            )
        RrListGroup {
            s.providers.forEachIndexed { i, p ->
                RrListRow(
                    p.label,
                    subtitle =
                        if (p.managed) stringResource(CR.string.managed_by_your_server)
                        else
                            p.model +
                                when {
                                    p.isDefault -> " · " + stringResource(R.string.v2_default)
                                    p.provider == Provider.Ollama ->
                                        " · " + stringResource(R.string.v2_local)
                                    else -> ""
                                },
                    leading = {
                        RrIconTile(
                            if (p.provider == Provider.Ollama) D.drawable.ic_ph_desktop
                            else D.drawable.ic_ph_sparkle,
                            accent = p.isDefault,
                        )
                    },
                    divider = i < s.providers.lastIndex,
                    onClick = { edit(p.id) },
                    trailing = {
                        Crossfade(
                            p.testStatus,
                            animationSpec = tween(RrMotion.D1),
                            label = "provider status",
                        ) { status ->
                            RrBadge(
                                when (status) {
                                    "success" -> stringResource(R.string.screen_connected)
                                    "failure" ->
                                        if (p.testErrorKind == "auth")
                                            stringResource(R.string.v2_failed_key)
                                        else stringResource(CR.string.failed)
                                    else -> stringResource(R.string.screen_not_tested)
                                },
                                tone =
                                    when (status) {
                                        "success" -> RrBadgeTone.Accent
                                        "failure" -> RrBadgeTone.Danger
                                        else -> RrBadgeTone.Neutral
                                    },
                            )
                        }
                    },
                )
            }
        }
        Row(
            Modifier.padding(start = 24.dp, end = 24.dp, top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            RrIcon(D.drawable.ic_ph_key, null, size = 16.dp, tint = RrTheme.colors.warnText)
            RrText(
                stringResource(
                    CR.string
                        .your_provider_may_charge_your_account_for_requests_made_with_your_api_key
                ),
                style = RrType.small,
                color = RrTheme.colors.warnText,
            )
        }
        RrSectionHeading(stringResource(R.string.screen_assistant_and_coach))
        RrListGroup {
            RrListRow(
                stringResource(CR.string.web_access),
                subtitle = stringResource(R.string.v2_web_providers),
                divider = true,
                onClick = { developer("web") },
                trailing = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RrRowValue(
                            s.web?.let {
                                if (it.configured) stringResource(R.string.screen_connected)
                                else stringResource(R.string.screen_not_set_up)
                            } ?: "—",
                            caret = false,
                        )
                        RrRowCaret()
                    }
                },
            )
            RrListRow(
                stringResource(R.string.v2_remember_facts),
                subtitle = stringResource(R.string.v2_from_messages),
                divider = true,
                onClick = { developer("memory") },
                trailing = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RrRowValue(memorySummary(s.memory), caret = false)
                        RrRowCaret()
                    }
                },
            )
            RrListRow(
                stringResource(R.string.screen_usage),
                subtitle = stringResource(R.string.v2_usage_summary),
                onClick = { developer("usage") },
                trailing = { RrRowCaret() },
            )
        }
        RrSectionHeading(stringResource(R.string.screen_developer))
        RrListGroup {
            RrListRow(
                stringResource(CR.string.mcp_server),
                subtitle =
                    stringResource(R.string.screen_sign_in_from_your_ai_client_or_use_an_api_key),
                divider = true,
                onClick = { developer("mcp") },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(CR.string.api_keys),
                subtitle =
                    s.apiKeys
                        ?.takeIf { it.isNotEmpty() }
                        ?.let { keys ->
                            pluralStringResource(
                                R.plurals.v2_keys_summary,
                                keys.size,
                                keys.size,
                                stringResource(
                                        if (newestKeyReadOnly(keys)) CR.string.read_only
                                        else CR.string.full_access
                                    )
                                    .lowercase(java.util.Locale.ROOT),
                            )
                        },
                divider = true,
                onClick = { developer("keys") },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(CR.string.connected_applications),
                subtitle = s.connections?.joinToString { it.clientName ?: it.clientId },
                onClick = { developer("applications") },
                trailing = { RrRowCaret() },
            )
        }
        nextSteps()
    }
}

@Composable
private fun memorySummary(
    mode: me.rxresu.core.network.generated.SaveCareerProfileRequestMemoryMode?
): String =
    when (mode?.wireValue) {
        "ask" -> stringResource(R.string.v2_ask_first)
        "auto" -> stringResource(R.string.v2_automatically)
        "off" -> stringResource(CR.string.off)
        else -> "—"
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
    var providerPicker by remember { mutableStateOf(false) }
    var modelEditor by remember { mutableStateOf(false) }
    var keyEditor by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var discard by remember { mutableStateOf(false) }
    val haptic = rememberRrHaptics()
    val managed = s.original?.managed == true
    val dismiss = { if (s.dirty) discard = true else close() }
    androidx.activity.compose.BackHandler(s.dirty) { dismiss() }
    LaunchedEffect(s.testCount, s.error) {
        when {
            s.error || (s.testCount > 0 && s.testStatus == "failure") -> haptic(RrHaptic.Error)
            s.testCount > 0 && s.testStatus == "success" -> haptic(RrHaptic.Success)
        }
    }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).imePadding()) {
        RrTopBar(onClose = dismiss)
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
            RrPageTitle(if (s.isNew) stringResource(CR.string.add_ai_provider) else s.label)
            if (s.loading) RrSkeletonText(Modifier.padding(24.dp), lines = 5)
            else if (managed) {
                RrCallout(stringResource(CR.string.managed_by_your_server), Modifier.padding(24.dp))
                RrText(s.model, Modifier.padding(horizontal = 24.dp), style = RrType.mono)
            } else {
                Column(
                    Modifier.padding(start = 24.dp, end = 24.dp, top = 24.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    RrPickerField(
                        providerNames.getValue(s.provider),
                        { providerPicker = true },
                        label = stringResource(R.string.v2_provider),
                        enabled = !s.busy,
                    )
                    RrTextField(
                        s.label,
                        { v -> edit { it.copy(label = v) } },
                        label = stringResource(CR.string.name),
                        enabled = !s.busy,
                    )
                    Column {
                        if (s.original != null && s.key.isEmpty())
                            RrPickerField(
                                s.original.apiKeyPreview,
                                { keyEditor = true },
                                label = stringResource(CR.string.api_key),
                                trailingIcon = null,
                                enabled = !s.busy,
                            )
                        else
                            RrTextField(
                                s.key,
                                { v -> edit { it.copy(key = v) } },
                                label = stringResource(CR.string.api_key),
                                enabled = !s.busy,
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions =
                                    KeyboardOptions(
                                        keyboardType = KeyboardType.Password,
                                        autoCorrectEnabled = false,
                                    ),
                            )
                        Crossfade(
                            s.testStatus,
                            animationSpec = tween(RrMotion.D2),
                            label = "test status",
                        ) { result ->
                            if (result == "success" && s.testCount > 0)
                                RrCallout(
                                    stringResource(R.string.screen_connected),
                                    tone = RrTone.Accent,
                                )
                            else if (result == "failure")
                                RrCallout(providerError(s.testErrorKind), tone = RrTone.Danger)
                        }
                    }
                    RrPickerField(
                        s.model,
                        { modelEditor = true },
                        label = stringResource(CR.string.model),
                        enabled = !s.busy,
                    )
                    RrTextField(
                        s.baseURL,
                        { v -> edit { it.copy(baseURL = v) } },
                        label = stringResource(CR.string.base_url),
                        placeholder = stringResource(R.string.v2_optional),
                        ltr = true,
                        enabled = !s.busy,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    )
                    if (s.error) ErrorCallout()
                    s.problem?.let { problem ->
                        RrCallout(
                            when (problem) {
                                "name" -> stringResource(R.string.screen_name_is_required)
                                "url" -> stringResource(CR.string.enter_an_http_or_https_base_url)
                                "key" ->
                                    stringResource(CR.string.enter_an_api_key_for_this_provider)
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
                    if (!s.isNew && s.original != null) {
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
        if (!managed)
            RrFooterBar {
                RrButton(
                    stringResource(R.string.v2_test),
                    test,
                    Modifier.weight(1f),
                    variant = RrButtonVariant.Secondary,
                    size = RrButtonSize.Large,
                    loading = s.busy,
                )
                RrButton(
                    stringResource(CR.string.save),
                    save,
                    Modifier.weight(1f),
                    size = RrButtonSize.Large,
                    enabled =
                        !s.busy && s.original != null && (!s.isNew || s.testStatus == "success"),
                )
            }
        else Box(Modifier.rrNavigationBarsPadding())
    }
    if (discard)
        RrAlertDialog(
            stringResource(CR.string.discard_changes_302d315bf9),
            stringResource(R.string.screen_unsaved_changes_will_be_lost),
            stringResource(CR.string.discard_changes),
            close,
            { discard = false },
            dismissLabel = stringResource(CR.string.keep_editing),
        )
    if (providerPicker)
        SearchPicker(
            stringResource(R.string.v2_provider),
            providerNames.map { it.key.name to it.value },
            { providerPicker = false },
        ) {
            choose(Provider.valueOf(it))
            providerPicker = false
        }
    if (keyEditor)
        RrBottomSheet({ keyEditor = false }, title = stringResource(CR.string.api_key)) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                RrTextField(
                    s.key,
                    { v -> edit { it.copy(key = v) } },
                    label = stringResource(CR.string.api_key),
                    helper = stringResource(CR.string.leave_empty_to_keep_the_saved_key),
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions =
                        KeyboardOptions(
                            keyboardType = KeyboardType.Password,
                            autoCorrectEnabled = false,
                        ),
                    enabled = !s.busy,
                )
                RrButton(
                    stringResource(CR.string.done),
                    { keyEditor = false },
                    Modifier.fillMaxWidth(),
                    size = RrButtonSize.Large,
                )
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
