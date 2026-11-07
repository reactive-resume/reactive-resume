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
    actions: @Composable RowScope.() -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).navigationBarsPadding()) {
        RrTopBar(title, onBack = back, status = status, actions = actions)
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(bottom = 16.dp),
            content = content,
        )
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
) {
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg).navigationBarsPadding()) {
        CloseBar(stringResource(R.string.screen_close_settings), close)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
            RrText(
                stringResource(CR.string.settings),
                Modifier.padding(horizontal = 16.dp),
                style = RrType.title,
            )
            if (s.loading && s.account == null) RrSkeletonText(Modifier.padding(16.dp), lines = 3)
            s.account?.let { account ->
                RrCard(
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 14.dp),
                    onClick = { navigate(SettingsAccount) },
                    contentPadding = PaddingValues(14.dp),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AccountAvatar(account, size = 56.dp)
                        Column(Modifier.weight(1f)) {
                            RrText(account.name, style = RrType.label)
                            RrText(
                                "${account.email} · @${account.username}",
                                style = RrType.small,
                                color = RrTheme.colors.ink3,
                            )
                        }
                        RrRowCaret()
                    }
                }
            }
            if (s.offline) RrOfflineStrip()
            if (s.error) ErrorCallout()
            RrSectionHeader(stringResource(CR.string.settings))
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
                NavRow(
                    stringResource(CR.string.account),
                    stringResource(R.string.screen_sign_in_security_your_data),
                    D.drawable.ic_ph_user,
                ) {
                    navigate(SettingsAccount)
                }
                NavRow(
                    stringResource(CR.string.profile),
                    stringResource(R.string.screen_details_applications_ask_for),
                    D.drawable.ic_ph_identification_card,
                ) {
                    navigate(SettingsProfile)
                }
                NavRow(
                    stringResource(CR.string.preferences),
                    stringResource(R.string.screen_theme_language_timezone_notifications),
                    D.drawable.ic_ph_sliders_horizontal,
                ) {
                    navigate(SettingsPreferences)
                }
                val provider = s.providers.firstOrNull { it.isDefault }
                NavRow(
                    stringResource(CR.string.ai_developer),
                    when {
                        s.providerError -> stringResource(CR.string.failed)
                        provider?.testStatus == "failure" -> stringResource(CR.string.failed)
                        provider?.testStatus == "success" -> stringResource(CR.string.ai_is_ready)
                        else -> stringResource(R.string.screen_not_set_up)
                    },
                    D.drawable.ic_ph_sparkle,
                ) {
                    navigate(SettingsAi)
                }
            }
            RrSectionHeader(stringResource(R.string.screen_about_reactive_resume))
            RrListGroup(Modifier.padding(horizontal = 16.dp)) {
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
                    val body =
                        "App: $appVersion\nServer: ${s.serverVersion ?: "unknown"}\nAndroid: ${Build.VERSION.RELEASE}"
                    browser(
                        "https://github.com/reactive-resume/reactive-resume/issues/new?body=${Uri.encode(body)}"
                    )
                }
                ExternalRow(stringResource(R.string.screen_donate), D.drawable.ic_ph_heart) {
                    browser("https://opencollective.com/reactive-resume/donate")
                }
            }
            RrText(
                "${server.removePrefix("https://")} · ${s.serverVersion ?: "—"} · $appVersion",
                Modifier.padding(16.dp),
                style = RrType.small,
                color = RrTheme.colors.ink3,
            )
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
    SettingsFrame(stringResource(CR.string.account), back) {
        if (s.loading && account == null) RrSkeletonText(Modifier.padding(16.dp), lines = 4)
        if (s.offline) RrOfflineStrip()
        if (s.error) ErrorCallout()
        RrSectionHeader(stringResource(CR.string.account_details))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            RrListRow(
                stringResource(CR.string.photo),
                leading = { AccountAvatar(account) },
                onClick = photo,
                trailing = {
                    RrButton(
                        stringResource(CR.string.change_photo),
                        photo,
                        variant = RrButtonVariant.Secondary,
                        size = RrButtonSize.Small,
                        enabled = !s.busy,
                    )
                    if (account?.image != null)
                        RrIconButton(
                            D.drawable.ic_ph_trash,
                            stringResource(CR.string.remove_photo),
                            removePhoto,
                            enabled = !s.busy,
                        )
                },
            )
            RrListRow(
                account?.name.orEmpty(),
                subtitle = stringResource(CR.string.name),
                onClick = {
                    value = account?.name.orEmpty()
                    editor = "name"
                },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                account?.username.orEmpty(),
                subtitle = stringResource(CR.string.username),
                onClick = {
                    value = account?.username.orEmpty()
                    editor = "username"
                },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                account?.email.orEmpty(),
                subtitle = stringResource(CR.string.email),
                onClick = { browser(securityUrl) },
                trailing = {
                    RrBadge(
                        if (account?.emailVerified == true) stringResource(R.string.screen_verified)
                        else stringResource(R.string.screen_not_verified_yet_resend_the_link),
                        tone =
                            if (account?.emailVerified == true) RrBadgeTone.Accent
                            else RrBadgeTone.Warn,
                    )
                },
            )
        }
        RrSectionHeader(stringResource(R.string.screen_sign_in_and_security))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            NavRow(stringResource(CR.string.password), browserHint, D.drawable.ic_ph_password) {
                browser(securityUrl)
            }
            val security = s.security as? AccountSecurityInfo.Available
            NavRow(
                stringResource(CR.string.two_step_verification),
                security?.let {
                    if (it.twoStepEnabled) stringResource(CR.string.on)
                    else stringResource(CR.string.off)
                } ?: browserHint,
                D.drawable.ic_ph_shield_check,
            ) {
                browser(securityUrl)
            }
            NavRow(
                stringResource(CR.string.passkeys),
                security?.passkeys?.joinToString() ?: browserHint,
                D.drawable.ic_ph_fingerprint,
            ) {
                browser(securityUrl)
            }
            security?.connectedProviders?.forEach { provider ->
                NavRow(
                    provider,
                    stringResource(R.string.screen_connected),
                    D.drawable.ic_ph_plugs_connected,
                ) {
                    browser(securityUrl)
                }
            }
            NavRow(
                stringResource(R.string.screen_sessions),
                browserHint,
                D.drawable.ic_ph_device_mobile,
            ) {
                browser(securityUrl)
            }
        }
        RrSectionHeader(stringResource(CR.string.your_data))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            NavRow(
                stringResource(CR.string.export_everything),
                null,
                D.drawable.ic_ph_download_simple,
                export,
            )
            RrListRow(
                stringResource(R.string.screen_delete_account),
                subtitle = browserHint,
                icon = D.drawable.ic_ph_trash,
                danger = true,
                onClick = { browser(securityUrl) },
            )
        }
        RrListGroup(Modifier.padding(16.dp)) {
            RrListRow(
                stringResource(CR.string.server),
                subtitle = server,
                icon = D.drawable.ic_ph_globe_simple,
                enabled = !s.busy,
                onClick = {
                    switching = true
                    leaving = true
                },
                trailing = { RrRowCaret() },
            )
            RrListRow(
                stringResource(CR.string.sign_out),
                icon = D.drawable.ic_ph_sign_out,
                danger = true,
                enabled = !s.busy,
                onClick = {
                    switching = false
                    leaving = true
                },
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
        // The account's interface language: LocaleManager on 13+, the stored choice and a recreate on 8–12.
        if (!inspection) s.account?.locale?.wireValue?.let { language -> activity?.applyInterfaceLocale(language) }
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
    SettingsFrame(stringResource(CR.string.preferences), back) {
        if (s.error) ErrorCallout()
        RrSectionHeader(stringResource(CR.string.appearance))
        Column(
            Modifier.padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            RrSegmentedControl(
                listOf(
                    RrSegment(stringResource(CR.string.light), D.drawable.ic_ph_sun),
                    RrSegment(stringResource(CR.string.dark), D.drawable.ic_ph_moon),
                    RrSegment(
                        stringResource(R.string.screen_match_system),
                        D.drawable.ic_ph_device_mobile,
                    ),
                ),
                s.preferences.theme.ordinal,
                { i -> preference { setTheme(ThemePreference.entries[i]) } },
            )
            RrText(
                stringResource(CR.string.resumes_always_render_on_white_paper_whatever_the_theme),
                style = RrType.caption,
                color = RrTheme.colors.ink3,
            )
        }
        RrSectionHeader(stringResource(R.string.screen_language_and_region))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            RrListRow(
                stringResource(R.string.screen_interface_language),
                subtitle =
                    stringResource(
                        CR.string.interface_only_each_resume_sets_its_own_language_in_design
                    ),
                icon = D.drawable.ic_ph_translate,
                onClick = { picker = "language" },
                trailing = {
                    RrRowValue(
                        s.account?.locale?.wireValue?.let {
                            Locale.forLanguageTag(it)
                                .getDisplayLanguage(LocalConfiguration.current.locales[0])
                        } ?: "English"
                    )
                },
            )
            RrListRow(
                stringResource(CR.string.timezone),
                subtitle =
                    stringResource(
                        CR.string.interview_times_reminders_and_schedules_in_career_use_it
                    ),
                icon = D.drawable.ic_ph_clock,
                onClick = { picker = "timezone" },
                trailing = {
                    RrRowValue(
                        s.account?.timezone?.substringAfterLast('/')?.replace('_', ' ') ?: "UTC"
                    )
                },
            )
        }
        RrSectionHeader(stringResource(R.string.screen_notifications))
        if (!permitted)
            RrCallout(
                stringResource(R.string.screen_off_in_system_settings),
                Modifier.padding(horizontal = 16.dp),
                actionLabel = stringResource(CR.string.open_settings),
                onAction = {
                    context.startActivity(
                        Intent(AndroidSettings.ACTION_APP_NOTIFICATION_SETTINGS)
                            .putExtra(AndroidSettings.EXTRA_APP_PACKAGE, context.packageName)
                    )
                },
            )
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            NotificationCategory.entries.forEach { category ->
                RrSwitchRow(
                    notificationTitle(category),
                    category in s.preferences.notifications,
                    { enabled ->
                        if (enabled && !permitted && Build.VERSION.SDK_INT >= 33) {
                            pendingCategory = category
                            permission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else if (!enabled || permitted)
                            preference { setNotification(category, enabled) }
                    },
                )
            }
        }
        RrSectionHeader(stringResource(R.string.screen_touch))
        RrListGroup(Modifier.padding(horizontal = 16.dp)) {
            CompositionLocalProvider(LocalRrHapticsEnabled provides false) {
                RrSwitchRow(
                    stringResource(R.string.screen_haptics),
                    s.preferences.haptics,
                    { enabled ->
                        if (enabled) view.rrHaptic(RrHaptic.ToggleOn)
                        preference { setHaptics(enabled) }
                    },
                    subtitle = stringResource(R.string.screen_also_follows_your_system_setting),
                    icon = D.drawable.ic_ph_vibrate,
                )
            }
        }
        RrSectionHeader(stringResource(R.string.screen_motion))
        RrSegmentedControl(
            listOf(
                RrSegment(stringResource(R.string.screen_match_system)),
                RrSegment(stringResource(R.string.screen_reduced)),
                RrSegment(stringResource(R.string.screen_full)),
            ),
            when (s.preferences.reducedMotion) {
                null -> 0
                true -> 1
                false -> 2
            },
            { i ->
                preference {
                    setReducedMotion(
                        when (i) {
                            1 -> true
                            2 -> false
                            else -> null
                        }
                    )
                }
            },
            Modifier.padding(horizontal = 16.dp),
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
    if (shortcuts) ShortcutsSheet { shortcuts = false }
    if (picker != null) {
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
        RrTopBar("", flat = true)
        RrIconButton(
            D.drawable.ic_ph_x,
            label,
            close,
            Modifier.statusBarsPadding().padding(start = 6.dp, top = 6.dp),
        )
    }
}
