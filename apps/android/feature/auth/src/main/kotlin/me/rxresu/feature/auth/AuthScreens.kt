package me.rxresu.feature.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import me.rxresu.core.designsystem.*
import me.rxresu.core.designsystem.R as D
import me.rxresu.core.strings.R as CR

@Composable
internal fun AuthFrame(
    back: () -> Unit,
    footer: @Composable () -> Unit = {},
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxSize().background(RrTheme.colors.bg).rrNavigationBarsPadding().imePadding()
    ) {
        RrTopBar(onBack = back)
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
            content = content,
        )
        footer()
    }
}

@Composable
internal fun WelcomeScreen(
    s: AuthUiState,
    edit: ((AuthUiState) -> AuthUiState) -> Unit = {},
    next: () -> Unit = {},
    check: () -> Unit = {},
    register: () -> Unit = {},
    checkServer: () -> Unit = {},
) {
    var serverEditor by remember { mutableStateOf(false) }
    val still = LocalInspectionMode.current || RrTheme.reducedMotion
    val progress = remember {
        List(3) { androidx.compose.animation.core.Animatable(if (still) 1f else 0f) }
    }
    LaunchedEffect(still) {
        coroutineScope {
            progress.forEachIndexed { index, animation ->
                launch {
                    if (still) animation.snapTo(1f)
                    else {
                        delay(index * 80L)
                        animation.animateTo(1f, tween(RrMotion.D3, easing = RrMotion.ease))
                    }
                }
            }
        }
    }
    fun entrance(index: Int) =
        Modifier.graphicsLayer {
            alpha = progress[index].value
            translationY = (1f - progress[index].value) * 6.dp.toPx()
        }
    BoxWithConstraints(
        Modifier.fillMaxSize()
            .background(RrTheme.colors.bg)
            .rrStatusBarsPadding()
            .rrNavigationBarsPadding()
    ) {
        Column(
            Modifier.fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = maxHeight)
                .padding(start = 24.dp, end = 24.dp, top = 24.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Row(
                entrance(0).padding(top = 24.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                RrLogo(size = 28.dp, contentDescription = null)
                RrText(
                    "Reactive Resume",
                    style =
                        RrType.rowTitle.copy(
                            fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
                            lineHeight = 20.sp,
                        ),
                )
            }
            Column(entrance(1)) {
                RrText(
                    stringResource(R.string.v2_welcome_title),
                    style = RrType.bigNumber.copy(letterSpacing = (-0.01).em),
                    modifier = Modifier.semantics { heading() },
                )
                RrText(
                    stringResource(R.string.v2_welcome_body),
                    Modifier.padding(top = 16.dp),
                    style = RrType.body,
                    color = RrTheme.colors.ink2,
                )
            }
            Column(
                entrance(2).padding(bottom = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (s.error != null) AuthError(s.error)
                RrButton(
                    stringResource(R.string.v2_create_account),
                    register,
                    Modifier.fillMaxWidth(),
                    size = RrButtonSize.Large,
                    loading = s.busy,
                )
                RrButton(
                    stringResource(CR.string.sign_in),
                    next,
                    Modifier.fillMaxWidth(),
                    variant = RrButtonVariant.Secondary,
                    size = RrButtonSize.Large,
                    enabled = !s.busy,
                )
                Box(
                    Modifier.fillMaxWidth()
                        .clickable(
                            role = androidx.compose.ui.semantics.Role.Button,
                            onClick = check,
                        )
                        .padding(vertical = 4.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    RrText(
                        stringResource(R.string.v2_check_pdf),
                        style = RrType.textLink,
                        color = RrTheme.colors.accentText,
                    )
                }
                RrText(
                    androidx.compose.ui.text.buildAnnotatedString {
                        append(
                            stringResource(CR.string.server) +
                                ": " +
                                s.server.removePrefix("https://").removePrefix("http://") +
                                " · "
                        )
                        withStyle(
                            androidx.compose.ui.text.SpanStyle(color = RrTheme.colors.accentText)
                        ) {
                            append(stringResource(R.string.v2_change))
                        }
                    },
                    Modifier.fillMaxWidth().clickable(
                        role = androidx.compose.ui.semantics.Role.Button
                    ) {
                        serverEditor = true
                    },
                    style = RrType.ui,
                    color = RrTheme.colors.ink3,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
            }
        }
    }
    if (serverEditor)
        RrBottomSheet({ serverEditor = false }, title = stringResource(CR.string.server)) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                RrTextField(
                    s.server,
                    { v ->
                        edit {
                            it.copy(server = v, ownServer = v != "https://rxresu.me", info = null)
                        }
                    },
                    label = stringResource(CR.string.server),
                    ltr = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    enabled = !s.busy,
                )
                s.info?.let {
                    RrText(
                        it.origin.removePrefix("https://") + " · " + it.version,
                        style = RrType.ui,
                    )
                }
                if (s.error != null) AuthError(s.error)
                RrButton(
                    stringResource(R.string.v2_check_server),
                    checkServer,
                    Modifier.fillMaxWidth(),
                    size = RrButtonSize.Large,
                    loading = s.busy,
                    enabled = s.server.isNotBlank(),
                )
            }
        }
}

@Composable
internal fun SignInScreen(
    s: AuthUiState,
    register: Boolean = false,
    edit: ((AuthUiState) -> AuthUiState) -> Unit = {},
    submit: () -> Unit = {},
    provider: (String?) -> Unit = {},
    forgot: () -> Unit = {},
    toggle: () -> Unit = {},
    back: () -> Unit = {},
) {
    AuthFrame(
        back,
        footer = {
            if (s.info?.signupsDisabled == false || register)
                Box(
                    Modifier.fillMaxWidth()
                        .clickable(
                            role = androidx.compose.ui.semantics.Role.Button,
                            onClick = toggle,
                        )
                        .padding(horizontal = 24.dp, vertical = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    RrText(
                        androidx.compose.ui.text.buildAnnotatedString {
                            append(
                                stringResource(
                                    if (register) R.string.v2_already_account
                                    else R.string.v2_new_here
                                ) + " "
                            )
                            withStyle(
                                androidx.compose.ui.text.SpanStyle(
                                    color = RrTheme.colors.accentText
                                )
                            ) {
                                append(
                                    stringResource(
                                        if (register) CR.string.sign_in
                                        else R.string.v2_create_account
                                    )
                                )
                            }
                        },
                        style = RrType.ui,
                        color = RrTheme.colors.ink3,
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
        },
    ) {
        RrPageTitle(stringResource(if (register) R.string.v2_create_account else CR.string.sign_in))
        if (s.info == null && s.busy) RrSkeletonText(Modifier.padding(24.dp), lines = 3)
        val shake = Modifier.authShake(s.error)
        if (s.info?.password == true) {
            Column(
                Modifier.padding(start = 24.dp, end = 24.dp, top = 24.dp).then(shake),
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                if (register)
                    RrTextField(
                        s.name,
                        { v -> edit { it.copy(name = v) } },
                        label = stringResource(CR.string.name),
                        contentType = ContentType.PersonFullName,
                        enabled = !s.busy,
                    )
                val focus = LocalFocusManager.current
                RrTextField(
                    s.email,
                    { v -> edit { it.copy(email = v) } },
                    label =
                        stringResource(
                            if (register) CR.string.email else R.string.screen_email_or_username
                        ),
                    ltr = true,
                    contentType =
                        if (register) ContentType.EmailAddress
                        else ContentType.Username + ContentType.EmailAddress,
                    enabled = !s.busy,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                    keyboardActions =
                        KeyboardActions(
                            onNext = {
                                focus.moveFocus(androidx.compose.ui.focus.FocusDirection.Next)
                            }
                        ),
                )
                if (register)
                    RrTextField(
                        s.username,
                        { v -> edit { it.copy(username = v) } },
                        label = stringResource(CR.string.username),
                        contentType = ContentType.NewUsername,
                        enabled = !s.busy,
                    )
                PasswordField(
                    s.password,
                    { v -> edit { it.copy(password = v) } },
                    !s.busy,
                    register,
                    submit,
                )
                if (s.error != null) AuthError(s.error)
                RrButton(
                    stringResource(if (register) R.string.v2_create_account else CR.string.sign_in),
                    submit,
                    Modifier.fillMaxWidth(),
                    size = RrButtonSize.Large,
                    loading = s.busy,
                    enabled =
                        s.email.isNotBlank() &&
                            s.password.isNotBlank() &&
                            (!register || (s.name.isNotBlank() && s.username.isNotBlank())),
                )
            }
            if (!register)
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier.clickable(
                                role = androidx.compose.ui.semantics.Role.Button,
                                onClick = forgot,
                            )
                            .padding(vertical = 12.dp)
                    ) {
                        RrText(
                            stringResource(R.string.screen_forgot_password),
                            style = RrType.textLink,
                            color = RrTheme.colors.accentText,
                        )
                    }
                }
        } else if (s.error != null) AuthError(s.error)
        if (s.info?.passkey == true || s.info?.providers?.isNotEmpty() == true) {
            Column(
                Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                RrText(
                    stringResource(R.string.v2_or),
                    Modifier.fillMaxWidth(),
                    style = RrType.ui,
                    color = RrTheme.colors.ink3,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                if (s.info?.passkey == true && !register)
                    RrButton(
                        stringResource(R.string.v2_passkey),
                        { provider(null) },
                        Modifier.fillMaxWidth(),
                        variant = RrButtonVariant.Secondary,
                        size = RrButtonSize.Large,
                        icon = D.drawable.ic_ph_fingerprint,
                        enabled = !s.busy,
                    )
                s.info?.providers?.forEach { (id, name) ->
                    RrButton(
                        stringResource(R.string.v2_continue_provider, name),
                        { provider(id) },
                        Modifier.fillMaxWidth(),
                        variant = RrButtonVariant.Secondary,
                        size = RrButtonSize.Large,
                        icon = providerIcon(id),
                        enabled = !s.busy,
                    )
                }
            }
        }
    }
}

@Composable
private fun Modifier.authShake(error: String?, twice: Boolean = true): Modifier {
    val x = remember { androidx.compose.animation.core.Animatable(0f) }
    val still = RrTheme.reducedMotion || LocalInspectionMode.current
    LaunchedEffect(error) {
        if (error != null && !still)
            x.animateTo(
                0f,
                keyframes {
                    durationMillis = RrMotion.D2
                    0f at 0
                    -4f at 40
                    4f at 80
                    if (twice) {
                        -4f at 120
                        4f at 160
                    }
                    0f at 200
                },
            )
    }
    return graphicsLayer { translationX = x.value.dp.toPx() }
}

@Composable
private fun providerIcon(id: String): Int? =
    when (id) {
        "apple" -> D.drawable.ic_ph_apple_logo
        "google" -> D.drawable.ic_ph_google_logo
        "github" -> D.drawable.ic_ph_github_logo
        "linkedin" -> D.drawable.ic_ph_linkedin_logo
        else -> null
    }

@Composable
internal fun PasswordField(
    value: String,
    change: (String) -> Unit,
    enabled: Boolean,
    newPassword: Boolean,
    submit: () -> Unit,
) {
    var visible by remember { mutableStateOf(false) }
    RrTextField(
        value,
        change,
        label =
            if (newPassword) stringResource(R.string.screen_new_password)
            else stringResource(CR.string.password),
        enabled = enabled,
        contentType = if (newPassword) ContentType.NewPassword else ContentType.Password,
        visualTransformation =
            if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions =
            KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
        keyboardActions = KeyboardActions(onDone = { submit() }),
        trailing = {
            RrIconButton(
                D.drawable.ic_ph_eye,
                if (visible) stringResource(R.string.screen_hide_password)
                else stringResource(R.string.screen_show_password),
                { visible = !visible },
                Modifier.size(20.dp),
                size = RrIconButtonSize.Small,
                tint = RrTheme.colors.ink3,
            )
        },
    )
}

@Composable
internal fun TwoStepScreen(
    s: AuthUiState,
    backup: Boolean = false,
    change: (String) -> Unit = {},
    verify: () -> Unit = {},
    toggle: () -> Unit = {},
    back: () -> Unit = {},
) {
    val focus = remember { FocusRequester() }
    val inspection = LocalInspectionMode.current
    LaunchedEffect(s.error, backup) { if (!inspection) focus.requestFocus() }
    AuthFrame(back) {
        RrPageTitle(
            stringResource(
                if (backup) R.string.screen_enter_a_backup_code else R.string.v2_enter_code
            ),
            subtitle = if (backup) null else stringResource(R.string.v2_authenticator),
        )
        Column(
            Modifier.fillMaxWidth()
                .padding(start = 24.dp, end = 24.dp, top = 32.dp)
                .authShake(s.error, twice = false)
        ) {
            if (backup)
                RrTextField(
                    s.code,
                    change,
                    Modifier.focusRequester(focus),
                    label = stringResource(R.string.screen_enter_a_backup_code),
                    mono = true,
                    enabled = !s.busy,
                )
            else {
                val codeLabel = stringResource(R.string.screen_verification_code)
                Box {
                    RrTextField(
                        s.code,
                        { change(it.filter { c -> c in '0'..'9' }.take(6)) },
                        Modifier.matchParentSize().focusRequester(focus).semantics(
                            mergeDescendants = true
                        ) {
                            contentDescription = codeLabel
                        },
                        contentType = ContentType.SmsOtpCode,
                        enabled = !s.busy,
                        keyboardOptions =
                            KeyboardOptions(
                                keyboardType = KeyboardType.NumberPassword,
                                imeAction = ImeAction.Done,
                            ),
                        keyboardActions = KeyboardActions(onDone = { verify() }),
                    )
                    OtpBoxes(s.code, Modifier.background(RrTheme.colors.bg).clearAndSetSemantics {})
                }
            }
            if (s.error != null) AuthError(s.error)
            if (backup)
                RrButton(
                    stringResource(R.string.screen_verify),
                    verify,
                    Modifier.fillMaxWidth().padding(top = 20.dp),
                    size = RrButtonSize.Large,
                    loading = s.busy,
                    enabled = s.code.isNotBlank(),
                )
            Box(
                Modifier.padding(top = 20.dp)
                    .clickable(role = androidx.compose.ui.semantics.Role.Button, onClick = toggle)
                    .padding(vertical = 12.dp)
            ) {
                RrText(
                    stringResource(
                        if (backup) R.string.screen_use_an_authenticator_app_instead
                        else R.string.screen_use_a_backup_code_instead
                    ),
                    style = RrType.textLink,
                    color = RrTheme.colors.accentText,
                )
            }
        }
    }
}

// TODO(lead): move to designsystem with the one-time-code input (see the TODO in TwoStepScreen).
/**
 * Six code boxes in Geist Mono. One accent ring marks the box the next digit goes in and slides to
 * it at `d1`; a caret blinks inside it. Reduced motion and screenshots hold both still.
 */
@Composable
private fun OtpBoxes(code: String, modifier: Modifier = Modifier) {
    val c = RrTheme.colors
    val still = RrTheme.reducedMotion || LocalInspectionMode.current
    val current = code.length.coerceAtMost(5)
    BoxWithConstraints(modifier) {
        val gap = 8.dp
        val box = (maxWidth - gap * 5) / 6
        Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
            repeat(6) { i ->
                Box(
                    Modifier.weight(1f)
                        .height(56.dp)
                        .background(c.raised, RrShape.md)
                        .border(1.dp, c.controlBorder, RrShape.md),
                    contentAlignment = Alignment.Center,
                ) {
                    RrText(
                        code.getOrNull(i)?.toString().orEmpty(),
                        style = RrType.mono.copy(fontSize = 26.sp, lineHeight = 30.sp),
                    )
                }
            }
        }
        if (code.length < 6) {
            val x by
                animateDpAsState(
                    (box + gap) * current,
                    tween(if (still) 0 else RrMotion.D1, easing = RrMotion.ease),
                    label = "otp-ring",
                )
            val caret =
                if (still) 0f
                else
                    rememberInfiniteTransition(label = "otp-caret")
                        .animateFloat(
                            1f,
                            0f,
                            infiniteRepeatable(
                                keyframes {
                                    durationMillis = 1060
                                    1f at 0
                                    1f at 529
                                    0f at 530
                                    0f at 1060
                                }
                            ),
                            label = "otp-blink",
                        )
                        .value
            Box(
                Modifier.offset { IntOffset(x.roundToPx(), 0) }
                    .size(box, 56.dp)
                    .drawBehind {
                        val w = 3.dp.toPx()
                        drawRoundRect(
                            c.accentSoft,
                            Offset(-w / 2, -w / 2),
                            Size(size.width + w, size.height + w),
                            CornerRadius(RrRadius.md.toPx() + w / 2),
                            Stroke(w),
                        )
                    }
                    .border(1.dp, c.accent, RrShape.md),
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.size(1.5.dp, 24.dp)
                        .graphicsLayer { alpha = caret }
                        .background(c.accent)
                )
            }
        }
    }
}

@Composable
internal fun ForgotScreen(
    s: AuthUiState,
    edit: ((AuthUiState) -> AuthUiState) -> Unit = {},
    submit: () -> Unit = {},
    close: () -> Unit = {},
) {
    RrBottomSheet(
        close,
        title = stringResource(R.string.screen_forgot_password),
        confirmDiscard = s.email.isNotEmpty() && !s.sent,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (s.sent) {
                RrText(stringResource(R.string.screen_check_your_email), style = RrType.sheetTitle)
                RrText(s.email)
            } else {
                RrTextField(
                    s.email,
                    { v -> edit { it.copy(email = v) } },
                    label = stringResource(CR.string.email),
                    ltr = true,
                    contentType = ContentType.EmailAddress,
                    enabled = !s.busy,
                )
                if (s.error != null) AuthError(s.error)
                RrButton(
                    stringResource(R.string.screen_send_link),
                    submit,
                    Modifier.fillMaxWidth(),
                    size = RrButtonSize.Large,
                    loading = s.busy,
                    enabled = s.email.isNotBlank(),
                )
            }
        }
    }
}

@Composable
internal fun ResetScreen(
    s: AuthUiState,
    edit: ((AuthUiState) -> AuthUiState) -> Unit = {},
    submit: () -> Unit = {},
    back: () -> Unit = {},
) {
    AuthFrame(back) {
        RrText(stringResource(R.string.screen_create_new_password), style = RrType.title)
        PasswordField(s.password, { v -> edit { it.copy(password = v) } }, !s.busy, true, submit)
        if (s.error != null) AuthError(s.error)
        RrButton(
            stringResource(R.string.screen_reset_password),
            submit,
            Modifier.fillMaxWidth(),
            size = RrButtonSize.Large,
            loading = s.busy,
            enabled = s.password.isNotBlank(),
        )
    }
}

@Composable
internal fun ConsentScreen(s: AuthUiState, choose: (Boolean) -> Unit = {}, close: () -> Unit = {}) {
    var review by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().background(RrTheme.colors.bg)) {
        RrTopBar(onClose = close, closeLabel = stringResource(CR.string.close))
        Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState())) {
            if (s.busy && s.consent == null) {
                RrSkeletonText(Modifier.padding(24.dp), lines = 3)
                RrText(stringResource(R.string.screen_loading_connection_request))
            }
            s.consent?.let { request ->
                Row(
                    Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp).clickable(
                        role = androidx.compose.ui.semantics.Role.Button
                    ) {
                        review = true
                    },
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RrIconTile(
                        Modifier.size(56.dp).semantics {
                            contentDescription = request.clientId + "; " + request.redirectUri
                        },
                    ) { RrLogo(size = 32.dp, contentDescription = null) }
                    RrIcon(R.drawable.ic_ph_arrows_left_right, null, tint = RrTheme.colors.ink3)
                    RrIconTile(D.drawable.ic_ph_sparkle, Modifier.size(56.dp), accent = true)
                }
                RrText(
                    stringResource(R.string.v2_allow_title, request.clientName),
                    Modifier.padding(start = 24.dp, end = 24.dp, top = 24.dp),
                    style = RrType.pageTitle,
                )
                val host = android.net.Uri.parse(request.redirectUri).host ?: request.redirectUri
                RrText(
                    if (!s.consentUsername.isNullOrBlank())
                        stringResource(R.string.v2_signed_in, host, s.consentUsername)
                    else host,
                    Modifier.padding(start = 24.dp, end = 24.dp, top = 6.dp),
                    style = RrType.body,
                    color = RrTheme.colors.ink3,
                )
                RrSectionHeading(stringResource(R.string.v2_able_to))
                val scopes =
                    request.scopes.distinct().filter {
                        it !in setOf("openid", "profile", "email", "offline_access")
                    }
                RrListGroup {
                    scopes.forEachIndexed { i, scope ->
                        // Full grants, client ID and redirect are reviewed again before any Allow.
                        val title =
                            when (scope) {
                                "api:read" -> stringResource(R.string.v2_see_documents)
                                "api:write" -> stringResource(R.string.v2_change_documents)
                                "api:delete" -> stringResource(R.string.v2_trash_documents)
                                else -> scopeCopy(scope)
                            }
                        RrListRow(
                            title,
                            onClick = { review = true },
                            tile =
                                when (scope) {
                                    "api:read" -> D.drawable.ic_ph_eye
                                    "api:write" -> D.drawable.ic_ph_pencil_simple
                                    "api:delete" -> D.drawable.ic_ph_trash
                                    else -> D.drawable.ic_ph_check
                                },
                            divider = i < scopes.lastIndex,
                            titleMaxLines = 2,
                        )
                    }
                }
                RrText(
                    stringResource(R.string.v2_disconnect),
                    Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp),
                    style = RrType.ui,
                    color = RrTheme.colors.ink3,
                )
                if (!request.canGrantNatively)
                    RrCallout(
                        stringResource(
                            R.string
                                .screen_continue_in_browser_to_review_and_complete_this_connection
                        ),
                        Modifier.padding(24.dp),
                    )
            }
            if (s.error != null) AuthError(s.error)
        }
        s.consent?.let { request ->
            RrFooterBar {
                if (request.canGrantNatively)
                    RrButton(
                        stringResource(R.string.v2_deny),
                        { choose(false) },
                        Modifier.weight(1f),
                        variant = RrButtonVariant.Secondary,
                        size = RrButtonSize.Large,
                        enabled = !s.busy,
                    )
                RrButton(
                    stringResource(
                        if (request.canGrantNatively) R.string.v2_allow
                        else CR.string.continue_in_browser
                    ),
                    { if (request.canGrantNatively) review = true else choose(true) },
                    Modifier.weight(1f),
                    size = RrButtonSize.Large,
                    loading = s.busy,
                )
            }
        }
    }
    if (review)
        s.consent?.let { request ->
            val grants = request.scopes.distinct().map { scopeCopy(it) }
            RrAlertDialog(
                request.clientName,
                request.clientId +
                    "\n" +
                    request.redirectUri +
                    "\n\n" +
                    grants.joinToString("\n\n"),
                stringResource(R.string.v2_allow),
                {
                    review = false
                    choose(true)
                },
                { review = false },
            )
        }
}

@Composable
private fun scopeCopy(scope: String): String =
    when (scope) {
        "api:read" ->
            stringResource(
                R.string
                    .screen_read_your_whole_account_including_a_full_data_export_your_profile_and_email_documents_job_
            )
        "api:write" ->
            stringResource(
                R.string
                    .screen_create_and_change_your_documents_and_job_applications_seeing_each_one_it_changes_in_full_a
            )
        "api:delete" -> stringResource(R.string.screen_delete_your_documents_and_account_data)
        "profile" -> stringResource(CR.string.read_your_profile_information)
        "email" -> stringResource(CR.string.read_your_email_address)
        "offline_access" ->
            stringResource(CR.string.keep_access_when_you_are_not_using_the_application)
        else -> scope
    }

@Composable
internal fun AuthError(error: String?) {
    AnimatedVisibility(
        error != null,
        enter =
            if (RrTheme.reducedMotion) fadeIn(tween(RrMotion.D1))
            else
                expandVertically(tween(RrMotion.D2, easing = RrMotion.ease)) +
                    fadeIn(tween(RrMotion.D1)),
        exit = fadeOut(tween(RrMotion.D1)),
    ) {
        if (error != null)
            RrCallout(
                when (error) {
                    AuthViewModel.ERROR_SERVER ->
                        stringResource(
                            R.string
                                .screen_couldn_t_reach_that_server_check_the_address_and_try_again
                        )
                    AuthViewModel.ERROR_NETWORK ->
                        stringResource(R.string.screen_couldn_t_sign_in_try_again)
                    else -> error
                },
                tone = RrTone.Danger,
            )
    }
}
