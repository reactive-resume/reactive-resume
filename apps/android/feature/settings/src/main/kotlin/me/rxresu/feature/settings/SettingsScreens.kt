package me.rxresu.feature.settings

import android.Manifest
import android.app.NotificationManager
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.provider.Settings as AndroidSettings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import java.time.ZoneId
import java.util.Locale
import me.rxresu.core.data.*
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.navigation.*
import me.rxresu.core.network.generated.*
import me.rxresu.core.strings.R as CR

@Composable
internal fun SettingsFrame(
    title: String,
    back: () -> Unit,
    scroll: ScrollState = rememberScrollState(),
    status: (@Composable RowScope.() -> Unit)? = null,
    subtitle: String? = null,
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(RrTheme.colors.bg).rrNavigationBarsPadding().imePadding()
    ) {
        RrTopBar(onBack = back, actions = actions)
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(bottom = 16.dp)) {
            RrPageTitle(title, subtitle = subtitle)
            content()
        }
    }
}

@Composable
internal fun SettingsScreen(
    s: SettingsState,
    server: String,
    appVersion: String,
    close: () -> Unit = {},
    navigate: (Any) -> Unit = {},
    browser: (String) -> Unit = {},
    signOut: () -> Unit = {},
) {
    var about by remember { mutableStateOf<String?>(null) }
    var leaving by remember { mutableStateOf(false) }
    val haptic = rememberRrHaptics()
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).rrNavigationBarsPadding()) {
        CloseBar(stringResource(R.string.screen_close_settings), close)
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
            RrPageTitle(stringResource(CR.string.settings))
            if (s.loading && s.account == null) RrSkeletonText(Modifier.padding(24.dp), lines = 3)
            s.account?.let { account ->
                RrListGroup(Modifier.padding(top = 16.dp)) {
                    RrListRow(
                        account.name,
                        subtitle = account.email,
                        leading = { AccountAvatar(account, size = 56.dp) },
                        onClick = { navigate(SettingsAccount) },
                        trailing = { RrRowCaret() },
                    )
                }
            }
            if (s.offline) RrOfflineStrip()
            if (s.error) ErrorCallout()
            RrListGroup(Modifier.padding(top = 12.dp), topDivider = true) {
                RrListRow(
                    stringResource(R.string.v2_account_security),
                    tile = D.drawable.ic_ph_shield_check,
                    divider = true,
                    onClick = { navigate(SettingsAccount) },
                    trailing = { RrRowCaret() },
                )
                RrListRow(
                    stringResource(CR.string.preferences),
                    subtitle = stringResource(R.string.v2_preferences_summary),
                    tile = D.drawable.ic_ph_sliders_horizontal,
                    divider = true,
                    onClick = { navigate(SettingsPreferences) },
                    trailing = { RrRowCaret() },
                )
                RrListRow(
                    stringResource(R.string.v2_application_profile),
                    subtitle = stringResource(R.string.v2_profile_summary),
                    tile = D.drawable.ic_ph_identification_card,
                    divider = true,
                    onClick = { navigate(SettingsProfile) },
                    trailing = { RrRowCaret() },
                )
                val provider = s.providers.firstOrNull { it.isDefault }
                RrListRow(
                    stringResource(R.string.v2_ai_developer),
                    subtitle =
                        when {
                            s.providerError || provider?.testStatus == "failure" ->
                                stringResource(CR.string.failed)
                            provider != null ->
                                provider.label + " · " + stringResource(R.string.v2_default)
                            else -> stringResource(R.string.screen_not_set_up)
                        },
                    tile = D.drawable.ic_ph_sparkle,
                    onClick = { navigate(SettingsAi) },
                    trailing = { RrRowCaret() },
                )
            }
            RrSectionHeading(stringResource(R.string.v2_about))
            RrListGroup {
                RrListRow(
                    stringResource(R.string.v2_help_feedback),
                    divider = true,
                    onClick = { about = "help" },
                    trailing = { RrRowCaret() },
                )
                RrListRow(
                    stringResource(R.string.v2_privacy_terms),
                    divider = true,
                    onClick = { about = "privacy" },
                    trailing = { RrRowCaret() },
                )
                RrListRow(
                    stringResource(R.string.v2_version),
                    trailing = {
                        RrRowValue(
                            "${s.serverVersion ?: "—"} · ${server.removePrefix("https://").removePrefix("http://")}",
                            caret = false,
                        )
                    },
                )
            }
            Box(
                Modifier.padding(start = 24.dp, end = 24.dp, top = 12.dp)
                    .clickable(
                        enabled = !s.busy,
                        role = androidx.compose.ui.semantics.Role.Button,
                    ) {
                        if (s.pendingEdits) {
                            haptic(RrHaptic.Warning)
                            leaving = true
                        } else signOut()
                    }
                    .padding(vertical = 12.dp)
            ) {
                RrText(
                    stringResource(CR.string.sign_out),
                    style = RrType.textLink,
                    color = RrTheme.colors.dangerText,
                )
            }
        }
    }
    if (leaving)
        RrAlertDialog(
            stringResource(R.string.v2_sign_out_server, server.removePrefix("https://")),
            stringResource(R.string.screen_any_edits_not_yet_synced_from_this_device_will_be_lost),
            stringResource(CR.string.sign_out),
            {
                leaving = false
                signOut()
            },
            { leaving = false },
        )
    about?.let { section ->
        RrBottomSheet(
            { about = null },
            title =
                stringResource(
                    if (section == "help") R.string.v2_help_feedback else R.string.v2_privacy_terms
                ),
        ) {
            if (section == "help") {
                ExternalRow(stringResource(R.string.screen_docs), D.drawable.ic_ph_book_open) {
                    browser("https://docs.rxresu.me")
                }
                ExternalRow(stringResource(CR.string.source), D.drawable.ic_ph_github_logo) {
                    browser("https://github.com/reactive-resume/reactive-resume")
                }
                ExternalRow(stringResource(R.string.screen_translate), D.drawable.ic_ph_translate) {
                    browser("https://crowdin.com/project/reactive-resume")
                }
                ExternalRow(
                    stringResource(R.string.screen_report_a_bug),
                    D.drawable.ic_ph_warning_circle,
                ) {
                    browser(
                        "https://github.com/reactive-resume/reactive-resume/issues/new?body=" +
                            Uri.encode(
                                "App: $appVersion\nServer: ${s.serverVersion ?: "unknown"}\nAndroid: ${Build.VERSION.RELEASE}"
                            )
                    )
                }
                ExternalRow(stringResource(R.string.screen_donate), D.drawable.ic_ph_heart) {
                    browser("https://opencollective.com/reactive-resume/donate")
                }
            } else {
                RrListRow(
                    stringResource(R.string.v2_privacy),
                    onClick = { browser("$server/privacy-policy") },
                    divider = true,
                )
                RrListRow(
                    stringResource(R.string.v2_terms),
                    onClick = { browser("$server/terms-of-service") },
                )
            }
        }
    }
}

@Composable
internal fun AccountScreen(
    s: SettingsState,
    server: String,
    back: () -> Unit = {},
    update: (UpdateProfileRequest) -> Unit = {},
    signOut: () -> Unit = {},
    browser: (String) -> Unit = {},
    export: () -> Unit = {},
    photo: () -> Unit = {},
    removePhoto: () -> Unit = {},
) {
    var editor by remember { mutableStateOf<String?>(null) }
    var value by remember { mutableStateOf("") }
    var leaving by remember { mutableStateOf(false) }
    var switching by remember { mutableStateOf(false) }
    val account = s.account
    LaunchedEffect(account) {
        if (editor != null && value == if (editor == "name") account?.name else account?.username)
            editor = null
    }
    val securityUrl =
        (s.security as? AccountSecurityInfo.BrowserRequired)?.url
            ?: "$server/dashboard/settings/account"
    val browserHint = stringResource(CR.string.continue_in_browser)
    SettingsFrame(stringResource(R.string.v2_account_security), back) {
        if (s.offline) RrOfflineStrip()
        if (s.error) ErrorCallout()
        val security = s.security as? AccountSecurityInfo.Available
        RrListGroup(Modifier.padding(top = 20.dp), topDivider = true) {
            RrListRow(
                stringResource(CR.string.email),
                subtitle =
                    if (account?.emailVerified == true) account.email
                    else stringResource(R.string.screen_not_verified_yet_resend_the_link),
                divider = true,
                onClick = { browser(securityUrl) },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(CR.string.username),
                subtitle =
                    stringResource(R.string.v2_username_summary, account?.username.orEmpty()),
                divider = true,
                onClick = {
                    value = account?.username.orEmpty()
                    editor = "username"
                },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(CR.string.password),
                subtitle =
                    s.passwordChangedMonthsAgo?.let {
                        pluralStringResource(R.plurals.v2_password_changed, it, it)
                    } ?: browserHint,
                divider = true,
                onClick = { browser(securityUrl) },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(CR.string.two_step_verification),
                subtitle =
                    security?.let {
                        stringResource(
                            if (it.twoStepEnabled) R.string.v2_two_step_on else CR.string.off
                        )
                    } ?: browserHint,
                divider = true,
                onClick = { browser(securityUrl) },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(CR.string.passkeys),
                subtitle =
                    security?.let {
                        pluralStringResource(
                            R.plurals.v2_passkey_count,
                            it.passkeys.size,
                            it.passkeys.size,
                            it.passkeys.joinToString(),
                        )
                    } ?: browserHint,
                divider = true,
                onClick = { browser(securityUrl) },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(R.string.v2_connected_apps),
                subtitle = connectionSummary(s),
                onClick = { browser(securityUrl) },
                trailing = { RrRowCaret() },
            )
        }
        RrSectionHeading(stringResource(CR.string.your_data))
        RrListGroup {
            RrListRow(
                stringResource(R.string.v2_export_data),
                subtitle = stringResource(R.string.v2_export_summary),
                divider = true,
                onClick = export,
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(R.string.v2_delete_account),
                danger = true,
                onClick = { browser(securityUrl) },
            )
        }
        RrSectionHeading(stringResource(R.string.v2_account_details))
        RrListGroup {
            RrListRow(
                stringResource(CR.string.name),
                subtitle = account?.name,
                divider = true,
                onClick = {
                    value = account?.name.orEmpty()
                    editor = "name"
                },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(R.string.screen_sessions),
                subtitle = security?.sessionCount?.toString() ?: browserHint,
                divider = true,
                onClick = { browser(securityUrl) },
                trailing = { RrRowCaret() },
            )
            security?.connectedProviders?.forEach { provider ->
                RrListRow(
                    provider,
                    subtitle = stringResource(R.string.screen_connected),
                    divider = true,
                    onClick = { browser(securityUrl) },
                    trailing = { RrRowCaret() },
                )
            }
            RrListRow(
                stringResource(CR.string.server),
                subtitle = server,
                divider = true,
                onClick = {
                    switching = true
                    leaving = true
                },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(CR.string.sign_out),
                danger = true,
                enabled = !s.busy,
                onClick = {
                    switching = false
                    leaving = true
                },
            )
        }
        Row(Modifier.padding(24.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            RrButton(
                stringResource(R.string.v2_change_photo),
                photo,
                variant = RrButtonVariant.Secondary,
                enabled = !s.busy,
            )
            RrButton(
                stringResource(R.string.v2_remove_photo),
                removePhoto,
                variant = RrButtonVariant.Ghost,
                enabled = !s.busy,
            )
        }
    }
    if (editor != null) {
        val field = editor
        RrBottomSheet(
            { editor = null },
            title =
                if (field == "name") stringResource(CR.string.name)
                else stringResource(CR.string.username),
            confirmDiscard = value != if (field == "name") account?.name else account?.username,
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                val valid =
                    if (field == "name") value.trim().length in 1..64
                    else value.trim().matches(Regex("[a-zA-Z0-9._-]{3,64}"))
                RrTextField(
                    value,
                    { value = it },
                    label =
                        if (field == "name") stringResource(CR.string.name)
                        else stringResource(CR.string.username),
                    enabled = !s.busy,
                    error =
                        if (valid || value.isEmpty()) null
                        else if (field == "name")
                            stringResource(CR.string.enter_a_name_up_to_64_characters)
                        else
                            stringResource(
                                CR.string
                                    .use_3_to_64_latin_letters_az_numbers_dots_hyphens_and_underscores
                            ),
                )
                if (field == "username")
                    RrCallout(
                        stringResource(
                            R.string
                                .screen_your_public_links_will_change_links_you_ve_already_shared_keep_working_for_30_days_then_st
                        ),
                        tone = RrTone.Warn,
                    )
                if (s.error) ErrorCallout()
                RrButton(
                    stringResource(CR.string.save),
                    {
                        update(
                            if (field == "name") UpdateProfileRequest(name = value.trim())
                            else
                                UpdateProfileRequest(username = value.trim().lowercase(Locale.ROOT))
                        )
                    },
                    Modifier.fillMaxWidth(),
                    loading = s.busy,
                    enabled = valid,
                )
            }
        }
    }
    if (leaving)
        RrAlertDialog(
            if (switching) stringResource(CR.string.switch_server_e5f1c3fb2a)
            else stringResource(CR.string.sign_out_dc51e31f98),
            stringResource(R.string.screen_any_edits_not_yet_synced_from_this_device_will_be_lost),
            stringResource(CR.string.sign_out),
            {
                leaving = false
                signOut()
            },
            { leaving = false },
        )
}

@Composable
internal fun PreferencesScreen(
    s: SettingsState,
    back: () -> Unit = {},
    preference: (suspend PreferencesRepository.() -> Unit) -> Unit = {},
    update: (UpdateProfileRequest) -> Unit = {},
    browser: (String) -> Unit = {},
) {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val view = androidx.compose.ui.platform.LocalView.current
    val activity = androidx.activity.compose.LocalActivity.current
    val inspection = androidx.compose.ui.platform.LocalInspectionMode.current
    LaunchedEffect(s.account?.locale) {
        // The account's interface language: LocaleManager on 13+, the stored choice and a recreate
        // on 8–12.
        if (!inspection)
            s.account?.locale?.wireValue?.let { language ->
                activity?.applyInterfaceLocale(language)
            }
    }
    var picker by remember { mutableStateOf<String?>(null) }
    var shortcuts by remember { mutableStateOf(false) }
    var pendingCategory by remember { mutableStateOf<NotificationCategory?>(null) }
    var permitted by remember {
        mutableStateOf(
            context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
        )
    }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        permitted =
            context.getSystemService(NotificationManager::class.java).areNotificationsEnabled()
    }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
            permitted = allowed
            pendingCategory?.let { category ->
                if (allowed) preference { setNotification(category, true) }
            }
            pendingCategory = null
        }
    fun notify(category: NotificationCategory, enabled: Boolean) {
        if (enabled && !permitted && Build.VERSION.SDK_INT >= 33) {
            pendingCategory = category
            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
        } else if (!enabled || permitted) preference { setNotification(category, enabled) }
    }
    SettingsFrame(stringResource(CR.string.preferences), back) {
        if (s.error) ErrorCallout()
        RrSectionHeading(stringResource(CR.string.appearance), first = true)
        val themes =
            listOf(ThemePreference.MatchSystem, ThemePreference.Light, ThemePreference.Dark)
        RrSegmentedControl(
            listOf(
                RrSegment(stringResource(R.string.v2_system)),
                RrSegment(stringResource(CR.string.light)),
                RrSegment(stringResource(CR.string.dark)),
            ),
            themes.indexOf(s.preferences.theme),
            { i -> preference { setTheme(themes[i]) } },
            Modifier.padding(start = 24.dp, end = 24.dp, top = 8.dp),
        )
        RrListGroup(Modifier.padding(top = 8.dp)) {
            RrListRow(
                stringResource(CR.string.language),
                onClick = { picker = "region" },
                divider = true,
                trailing = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RrRowValue(interfaceLanguage(s.account?.locale), caret = false)
                        RrRowCaret()
                    }
                },
            )
            CompositionLocalProvider(LocalRrHapticsEnabled provides false) {
                RrSwitchRow(
                    stringResource(R.string.screen_haptics),
                    s.preferences.haptics,
                    { enabled ->
                        if (enabled) view.rrHaptic(RrHaptic.ToggleOn)
                        preference { setHaptics(enabled) }
                    },
                )
            }
        }
        RrSectionHeading(
            stringResource(R.string.v2_notify_about),
            Modifier.clickable(role = androidx.compose.ui.semantics.Role.Button) {
                picker = "notifications"
            },
        )
        RrListGroup {
            val categories =
                listOf(
                    NotificationCategory.InterviewsAndBriefings,
                    NotificationCategory.FollowUps,
                    NotificationCategory.NewRoles,
                    NotificationCategory.OfferDeadlines,
                )
            val labels =
                listOf(
                    stringResource(R.string.screen_interviews_and_briefings),
                    stringResource(R.string.v2_follow_ups),
                    stringResource(R.string.v2_new_roles),
                    stringResource(R.string.v2_offer_deadlines),
                )
            categories.forEachIndexed { i, category ->
                RrSwitchRow(
                    labels[i],
                    category in s.preferences.notifications,
                    { notify(category, it) },
                    divider = i < categories.lastIndex,
                )
            }
        }
    }
    if (picker == "region")
        RrBottomSheet(
            { picker = null },
            title = stringResource(R.string.screen_language_and_region),
        ) {
            RrListRow(
                stringResource(CR.string.language),
                divider = true,
                onClick = { picker = "language" },
                trailing = {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RrRowValue(interfaceLanguage(s.account?.locale), caret = false)
                        RrRowCaret()
                    }
                },
            )
            RrListRow(
                stringResource(CR.string.timezone),
                divider = true,
                onClick = { picker = "timezone" },
                trailing = { RrRowValue(s.account?.timezone ?: "UTC") },
            )
            RrListRow(
                stringResource(R.string.screen_help_translate),
                onClick = { browser("https://crowdin.com/project/reactive-resume") },
                trailing = { RrRowCaret() },
            )
            if (configuration.keyboard != Configuration.KEYBOARD_NOKEYS)
                RrListRow(
                    stringResource(CR.string.keyboard_shortcuts),
                    onClick = { shortcuts = true },
                    trailing = { RrRowCaret() },
                )
        }
    if (picker == "notifications")
        RrBottomSheet({ picker = null }, title = stringResource(R.string.screen_notifications)) {
            RrSwitchRow(
                stringResource(R.string.screen_feedback_comments),
                NotificationCategory.FeedbackComments in s.preferences.notifications,
                { notify(NotificationCategory.FeedbackComments, it) },
            )
            if (!permitted)
                RrCallout(
                    stringResource(R.string.screen_off_in_system_settings),
                    Modifier.padding(24.dp),
                    actionLabel = stringResource(CR.string.open_settings),
                    onAction = {
                        context.startActivity(
                            Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS)
                                .putExtra(AndroidSettings.EXTRA_APP_PACKAGE, context.packageName)
                        )
                    },
                )
        }
    if (shortcuts) ShortcutsSheet { shortcuts = false }
    if (picker == "timezone" || picker == "language") {
        val timezone = picker == "timezone"
        val options =
            if (timezone)
                (ZoneId.getAvailableZoneIds() +
                        (s.account?.timezone?.substringAfterLast('/')?.replace('_', ' ') ?: "UTC"))
                    .sorted()
                    .map { it to it }
            else
                ImportResumeFileLocale.entries
                    .filter { it != ImportResumeFileLocale.Unknown }
                    .map {
                        it.wireValue to
                            Locale.forLanguageTag(it.wireValue)
                                .getDisplayName(LocalConfiguration.current.locales[0])
                    }
        SearchPicker(
            if (timezone) stringResource(CR.string.search_timezones)
            else stringResource(R.string.screen_interface_language),
            options,
            { picker = null },
        ) { value ->
            update(
                if (timezone) UpdateProfileRequest(timezone = value)
                else
                    UpdateProfileRequest(
                        locale = ImportResumeFileLocale.entries.first { it.wireValue == value }
                    )
            )
            picker = null
        }
    }
}

@Composable
private fun interfaceLanguage(locale: ImportResumeFileLocale?): String {
    if (locale?.wireValue == "en-GB") return stringResource(R.string.v2_english_uk)
    return locale?.wireValue?.let {
        Locale.forLanguageTag(it).getDisplayName(LocalConfiguration.current.locales[0])
    } ?: "English"
}

@Composable
private fun connectionSummary(s: SettingsState): String? {
    val apps = s.connections ?: return null
    return if (apps.size > 1)
        pluralStringResource(
            R.plurals.v2_connection_summary,
            apps.size - 1,
            (apps.first().clientName ?: apps.first().clientId),
            apps.size - 1,
        )
    else apps.firstOrNull()?.let { it.clientName ?: it.clientId }
}

@Composable
internal fun SearchPicker(
    title: String,
    options: List<Pair<String, String>>,
    close: () -> Unit,
    choose: (String) -> Unit,
) {
    var search by remember { mutableStateOf("") }
    val filtered =
        remember(options, search) {
            options.filter { it.second.contains(search, true) || it.first.contains(search, true) }
        }
    RrBottomSheet(close, title = title, detents = RrSheetDetents.Full) {
        RrSearchField(
            search,
            { search = it },
            placeholder = title,
            modifier = Modifier.padding(16.dp),
        )
        if (filtered.isEmpty())
            RrText(stringResource(CR.string.no_timezone_matches), Modifier.padding(16.dp))
        LazyColumn {
            items(filtered, key = { it.first }) { (key, label) ->
                RrListRow(label, onClick = { choose(key) })
            }
        }
    }
}

@Composable
private fun notificationTitle(category: NotificationCategory): String =
    when (category) {
        NotificationCategory.InterviewsAndBriefings ->
            stringResource(R.string.screen_interviews_and_briefings)
        NotificationCategory.FollowUpsAndOfferDeadlines ->
            stringResource(R.string.screen_follow_ups_and_offer_deadlines)
        NotificationCategory.FollowUps -> stringResource(R.string.v2_follow_ups)
        NotificationCategory.OfferDeadlines -> stringResource(R.string.v2_offer_deadlines)
        NotificationCategory.NewRoles -> stringResource(CR.string.new_roles_from_your_search)
        NotificationCategory.FeedbackComments -> stringResource(R.string.screen_feedback_comments)
    }

@Composable
internal fun NavRow(
    title: String,
    subtitle: String? = null,
    icon: Int? = null,
    onClick: () -> Unit,
) =
    RrListRow(
        title,
        subtitle = subtitle,
        icon = icon,
        onClick = onClick,
        trailing = { RrRowCaret() },
    )

@Composable
internal fun ExternalRow(title: String, icon: Int, onClick: () -> Unit) =
    RrListRow(
        title,
        icon = icon,
        onClick = onClick,
        trailing = { RrIcon(D.drawable.ic_ph_arrow_square_out, null, size = 18.dp) },
    )

@Composable
internal fun ErrorCallout() =
    RrCallout(
        stringResource(CR.string.couldn_t_save_try_again),
        Modifier.padding(16.dp),
        tone = RrTone.Danger,
    )

internal fun initials(name: String) =
    name
        .trim()
        .split(Regex("\\s+"))
        .take(2)
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .joinToString("")

// TODO(lead): move to designsystem; RrTopBar needs a leading close-action slot for modal roots.
@Composable
private fun CloseBar(label: String, close: () -> Unit) {
    val dismiss by rememberUpdatedState(close)
    Box(
        Modifier.pointerInput(Unit) {
            var distance = 0f
            detectVerticalDragGestures(
                onDragStart = { distance = 0f },
                onVerticalDrag = { change, delta ->
                    if (delta > 0f || distance > 0f) {
                        change.consume()
                        distance = (distance + delta).coerceAtLeast(0f)
                    }
                },
                onDragEnd = { if (distance >= RrLayout.topBar.toPx()) dismiss() },
            )
        }
    ) {
        RrTopBar(onClose = close, closeLabel = label)
    }
}
