package me.rxresu.feature.settings

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import me.rxresu.core.designsystem.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.strings.R as CR

@Composable
internal fun DeveloperScreen(
    s: DeveloperState,
    key: (String) -> Unit,
    provider: (SaveWebAccessKeyRequestProvider) -> Unit,
    saveWeb: () -> Unit,
    testWeb: () -> Unit,
    removeWeb: () -> Unit,
    memory: (SaveCareerProfileRequestMemoryMode) -> Unit,
    disconnect: (String) -> Unit,
    retry: () -> Unit,
    close: () -> Unit,
    browser: (String) -> Unit,
    server: String,
) {
    val context = LocalContext.current
    val haptic = rememberRrHaptics()
    var removing by remember { mutableStateOf(false) }
    var application by remember { mutableStateOf<String?>(null) }
    val title =
        when (s.section) {
            "web" -> stringResource(CR.string.web_access)
            "memory" -> stringResource(CR.string.remember_facts_from_my_messages)
            "usage" -> stringResource(R.string.screen_usage)
            "mcp" -> stringResource(CR.string.mcp_server)
            "keys" -> stringResource(CR.string.api_keys)
            else -> stringResource(CR.string.connected_applications)
        }
    RrBottomSheet(
        close,
        title = title,
        detents = RrSheetDetents.Full,
        confirmDiscard = s.key.isNotEmpty(),
    ) {
        Column(
            Modifier.padding(16.dp).verticalScroll(rememberScrollState()).imePadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            if (s.loading) RrSkeletonText(lines = 4)
            if (s.error)
                RrCallout(
                    stringResource(
                        R.string.screen_couldn_t_load_or_save_web_access_settings_try_again
                    ),
                    tone = RrTone.Danger,
                    actionLabel = stringResource(R.string.screen_reload),
                    onAction = retry,
                )
            when (s.section) {
                "web" ->
                    s.web?.let { status ->
                        RrText(stringResource(CR.string.built_in_reader), style = RrType.label)
                        RrText(
                            stringResource(
                                CR.string.reads_supported_public_job_pages_no_account_needed
                            ),
                            style = RrType.small,
                        )
                        RrBadge(stringResource(CR.string.active), tone = RrBadgeTone.Accent)
                        if (status.managed)
                            RrCallout(
                                stringResource(
                                    R.string
                                        .screen_search_and_reading_are_set_up_for_everyone_here_ask_your_administrator_about_changes
                                )
                            )
                        if (status.configured)
                            RrText(status.provider?.let(::webProviderName).orEmpty(), style = RrType.label)
                        if (status.canSave && !status.managed) {
                            RrSegmentedControl(
                                webProviders.map { RrSegment(webProviderName(it)) },
                                webProviders.indexOf(s.provider).coerceAtLeast(0),
                                {
                                    if (!s.busy)
                                        provider(webProviders[it])
                                },
                            )
                            RrTextField(
                                s.key,
                                key,
                                label = stringResource(CR.string.api_key),
                                enabled = !s.busy,
                                visualTransformation = PasswordVisualTransformation(),
                                keyboardOptions =
                                    KeyboardOptions(
                                        keyboardType = KeyboardType.Password,
                                        autoCorrectEnabled = false,
                                    ),
                                helper =
                                    stringResource(R.string.screen_stored_encrypted_on_your_server),
                            )
                            RrText(
                                stringResource(
                                    CR.string
                                        .save_first_then_test_search_and_reading_no_test_runs_automatically
                                ),
                                style = RrType.small,
                                color = RrTheme.colors.ink3,
                            )
                            RrButton(
                                stringResource(CR.string.save_connection),
                                saveWeb,
                                Modifier.fillMaxWidth(),
                                enabled = s.key.isNotBlank(),
                                loading = s.busy,
                            )
                            if (status.configured)
                                RrButton(
                                    stringResource(CR.string.remove_connection),
                                    { removing = true },
                                    variant = RrButtonVariant.DangerGhost,
                                    enabled = !s.busy,
                                )
                        }
                        if (status.configured || status.searxng)
                            RrButton(
                                stringResource(CR.string.test_connection),
                                testWeb,
                                variant = RrButtonVariant.Secondary,
                                enabled = s.key.isEmpty(),
                                loading = s.busy,
                            )
                        s.test?.let { result ->
                            RrCallout(
                                if (result.search.success) stringResource(CR.string.search_works)
                                else webError(result.search.error),
                                tone = if (result.search.success) RrTone.Accent else RrTone.Warn,
                            )
                            if (status.configured)
                                RrCallout(
                                    if (result.read.success) stringResource(CR.string.reading_works)
                                    else webError(result.read.error),
                                    tone = if (result.read.success) RrTone.Accent else RrTone.Warn,
                                )
                        }
                    }
                "memory" ->
                    if (!s.loading) {
                        RrSegmentedControl(
                            listOf(
                                RrSegment(stringResource(CR.string.ask_first)),
                                RrSegment(stringResource(CR.string.automatically)),
                                RrSegment(stringResource(CR.string.off)),
                            ),
                            (s.memory?.ordinal ?: 0).coerceAtMost(2),
                            { if (!s.busy) memory(SaveCareerProfileRequestMemoryMode.entries[it]) },
                        )
                    }
                "usage" ->
                    s.usage?.let { usage ->
                        RrText("${usage.start} – ${usage.end}", style = RrType.mono)
                        RrText(usage.timezone, style = RrType.small)
                        RrText(usage.requests.toString(), style = RrType.display)
                        RrText(stringResource(R.string.screen_requests))
                        RrListGroup {
                            usage.groups.forEach { group ->
                                RrListRow(
                                    group.label,
                                    subtitle = "${group.provider} · ${group.model}",
                                    trailing = {
                                        RrRowValue(group.requests.toString(), caret = false)
                                    },
                                )
                            }
                        }
                    }
                "mcp" -> {
                    RrText(server.trimEnd('/') + "/mcp", style = RrType.mono)
                    RrButton(
                        stringResource(CR.string.copy),
                        {
                            context
                                .getSystemService(ClipboardManager::class.java)
                                .setPrimaryClip(
                                    ClipData.newPlainText(
                                        "MCP server",
                                        server.trimEnd('/') + "/mcp",
                                    )
                                )
                            haptic(RrHaptic.Success)
                        },
                        variant = RrButtonVariant.Secondary,
                    )
                    RrButton(
                        stringResource(CR.string.setup_guide),
                        { browser("https://docs.rxresu.me/guides/using-the-mcp-server") },
                        variant = RrButtonVariant.GhostAccent,
                    )
                }
                "keys" ->
                    if (!s.loading) {
                        val locale = androidx.compose.ui.platform.LocalConfiguration.current.locales[0]
                        val zone = me.rxresu.core.data.LocalRepositories.current.time.timezone()
                        val dates = remember(locale, zone) { SettingsDates(locale, zone, true) }
                        if (s.keys.isEmpty()) RrText(stringResource(CR.string.no_keys_yet))
                        RrListGroup {
                            s.keys.forEach { k ->
                                val readOnly =
                                    k.permissions?.get("api")?.let {
                                        "write" !in it && "delete" !in it
                                    } == true
                                RrListRow(
                                    k.name ?: k.start.orEmpty(),
                                    subtitle =
                                        (if (readOnly) stringResource(CR.string.read_only)
                                        else stringResource(CR.string.full_access)) +
                                            " · " +
                                            (k.expiresAt?.let { dates.date(it) ?: it } ?: stringResource(CR.string.never)),
                                )
                            }
                        }
                        RrButton(
                            stringResource(CR.string.continue_in_browser),
                            { browser("$server/dashboard/settings/ai#api-keys") },
                            Modifier.fillMaxWidth(),
                        )
                    }
                "applications" ->
                    if (!s.loading) {
                        if (s.applications.isEmpty())
                            RrText(stringResource(R.string.screen_no_connected_applications))
                        s.applications.forEach { app ->
                            RrCard {
                                RrText(app.clientName ?: app.clientId, style = RrType.label)
                                RrText(app.clientId, style = RrType.mono)
                                RrText(app.scopes.joinToString(" · "), style = RrType.small)
                                RrButton(
                                    stringResource(CR.string.disconnect),
                                    { application = app.id },
                                    variant = RrButtonVariant.DangerGhost,
                                    enabled = !s.busy,
                                )
                            }
                        }
                    }
            }
        }
    }
    if (removing)
        RrAlertDialog(
            stringResource(CR.string.remove_the_web_connection),
            stringResource(
                CR.string
                    .you_ll_need_to_enter_the_key_again_to_reconnect_the_built_in_reader_remains_active
            ),
            stringResource(CR.string.remove_connection),
            {
                removing = false
                removeWeb()
            },
            { removing = false },
            confirm = RrDialogConfirm.HoldToDelete,
        )
    if (application != null)
        RrAlertDialog(
            stringResource(R.string.screen_disconnect_application),
            stringResource(R.string.screen_this_application_will_lose_access_to_your_account),
            stringResource(CR.string.disconnect),
            {
                application?.let(disconnect)
                application = null
            },
            { application = null },
            confirm = RrDialogConfirm.HoldToDelete,
        )
}

@Composable
private fun webError(kind: String?): String =
    when (kind) {
        "auth" ->
            stringResource(
                R.string.screen_the_service_rejected_the_api_key_check_the_key_and_save_it_again
            )
        "quota" ->
            stringResource(
                R.string
                    .screen_the_service_s_quota_is_used_up_check_your_plan_with_the_service_or_try_again_later
            )
        "timeout" -> stringResource(CR.string.the_service_didn_t_respond_in_time_try_again)
        "rate-limit" -> stringResource(CR.string.too_many_requests_try_again_later)
        else ->
            stringResource(
                R.string.screen_the_service_is_unavailable_or_doesn_t_support_this_try_again_later
            )
    }

/** Product names, not the wire values ("firecrawl"). */
private fun webProviderName(provider: SaveWebAccessKeyRequestProvider) = when (provider) {
    SaveWebAccessKeyRequestProvider.Firecrawl -> "Firecrawl"
    SaveWebAccessKeyRequestProvider.Tavily -> "Tavily"
    SaveWebAccessKeyRequestProvider.Exa -> "Exa"
    SaveWebAccessKeyRequestProvider.Unknown -> ""
}

private val webProviders = listOf(SaveWebAccessKeyRequestProvider.Firecrawl, SaveWebAccessKeyRequestProvider.Tavily, SaveWebAccessKeyRequestProvider.Exa)
