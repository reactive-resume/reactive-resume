import { useLingui } from "@lingui/react/macro";
import { ORPCError } from "@orpc/client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { getNetworkStateAsync } from "expo-network";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Share, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PasswordExpiredError, downloadPublicPdf, publicResumeUrl } from "./download";
import { ResumeReflow } from "./resume-reflow";
import { isAuthorBlocked, loadSharedResume, setAuthorBlocked } from "./safety";
import { client } from "@/api/client";
import { useSession } from "@/auth/session";
import { ReportAiContent } from "@/features/ai/report-content";
import { routes } from "@/routes";
import { Button, EmptyState, Icon, IconButton, Skeleton, Text, TextField, showToast, useTheme } from "@/ui";

type PublicResumeProps = { username: string; slug: string };

const isOffline = async () => {
	const network = await getNetworkStateAsync();
	return network.isConnected === false || network.isInternetReachable === false;
};

/**
 * A shared resume opened from a link, for recruiters: the owner's name leads, the resume reflows as native text, and
 * Download PDF is the one action. Password-protected links ask first; off, unknown or trashed links read the same.
 */
export function PublicResume({ username, slug }: PublicResumeProps) {
	const { t } = useLingui();
	const router = useRouter();
	const session = useSession();
	const { colors, space } = useTheme();
	const [locked, setLocked] = useState(false);
	const [, refreshSafety] = useState(0);
	let blocked = false;
	let safetyUnavailable = false;
	try {
		blocked = isAuthorBlocked(username);
	} catch {
		safetyUnavailable = true;
	}
	const blockAuthor = (value: boolean) => {
		try {
			setAuthorBlocked(username, value);
			refreshSafety((version) => version + 1);
		} catch {
			showToast({ message: t`Couldn't save your blocked-author setting. Try again.` });
		}
	};

	const resume = useQuery({
		queryKey: ["public-resume", session.server, username, slug],
		queryFn: () => loadSharedResume(username, slug),
		enabled: session.status === "signed-in" && !blocked && !safetyUnavailable,
		retry: (count, error) => !(error instanceof ORPCError) && count < 2,
	});
	const needsPassword =
		locked || (resume.error instanceof ORPCError && resume.error.code === "NEED_PASSWORD" && !resume.data);

	// A renamed resume's old address still finds it for 30 days; move to the current one.
	const current = resume.data?.slug;
	useEffect(() => {
		if (current && current !== slug) router.replace(routes.publicResume(username, current));
	}, [current, router, slug, username]);

	const name = resume.data ? resume.data.data.basics.name || resume.data.name : "";
	const download = useMutation({
		mutationFn: async () => {
			if (await isOffline()) throw new Error("offline");
			await downloadPublicPdf(username, slug, name || t`Resume`, t`Download PDF`);
		},
		onError: async (error) => {
			// The password unlock lasts 10 minutes; past that the server asks again.
			if (error instanceof PasswordExpiredError) return setLocked(true);
			showToast({
				message: (await isOffline())
					? t`You're offline. Try again when you reconnect.`
					: t`Couldn't download the PDF. Try again.`,
				action: { label: t`Retry`, onPress: () => download.mutate() },
			});
		},
	});

	const share = () =>
		void Share.share({ url: publicResumeUrl(username, slug), message: publicResumeUrl(username, slug) }).catch(
			() => {},
		);

	if (blocked || safetyUnavailable)
		return (
			<View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: space.s12 }}>
				<Stack.Screen options={{ title: "" }} />
				<EmptyState
					icon="warning-circle"
					title={blocked ? t`This author is blocked.` : t`Couldn't read your blocked-author settings.`}
					message={t`Shared resumes stay hidden until your device settings allow them.`}
					action={
						blocked
							? { label: t`Unblock author`, onPress: () => blockAuthor(false) }
							: { label: t`Try again`, onPress: () => refreshSafety((version) => version + 1) }
					}
				/>
			</View>
		);

	if (needsPassword)
		return (
			<PasswordPrompt
				username={username}
				slug={slug}
				onUnlocked={() => {
					setLocked(false);
					void resume.refetch();
				}}
			/>
		);

	if (resume.isPending)
		return (
			<View
				accessibilityLabel={t`Loading…`}
				style={{ flex: 1, backgroundColor: colors.paper, padding: space.s5, gap: space.s3 }}
			>
				<Stack.Screen options={{ title: "" }} />
				<Skeleton width="60%" height={26} />
				<Skeleton width="80%" height={14} />
				<View style={{ flexDirection: "row", gap: space.s2 }}>
					<Skeleton width="30%" height={28} radius={14} />
					<Skeleton width="30%" height={28} radius={14} />
				</View>
				{Array.from({ length: 8 }, (_, index) => (
					<Skeleton key={index} height={12} />
				))}
			</View>
		);

	if (!resume.data) {
		const unavailable = resume.error instanceof ORPCError;
		return (
			<View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: space.s12 }}>
				<Stack.Screen options={{ title: "" }} />
				{unavailable ? (
					<EmptyState
						icon="link-simple-horizontal-break"
						title={t`This resume isn't shared right now.`}
						message={t`If someone sent you this link, ask them for a new one.`}
						action={{ label: t`Close`, onPress: () => router.back() }}
					/>
				) : (
					<EmptyState
						icon="wifi-slash"
						title={t`You're offline. This resume opens when you reconnect.`}
						action={{ label: t`Try again`, onPress: () => void resume.refetch() }}
					/>
				)}
			</View>
		);
	}

	const downloads = resume.data.showDownloadButtons !== false;

	return (
		<View style={{ flex: 1, backgroundColor: colors.paper }}>
			<Stack.Screen options={{ title: name }} />
			<ScrollView contentInsetAdjustmentBehavior="automatic">
				<View style={{ padding: space.s3, gap: space.s2 }}>
					<ReportAiContent source="public-resume" text={publicResumeUrl(username, slug)} />
					<Button size="sm" variant="link" label={t`Block this author`} onPress={() => blockAuthor(true)} />
				</View>
				<ResumeReflow data={resume.data.data} />
				<Text
					variant="caption"
					align="center"
					style={{ color: colors.paperInk, opacity: 0.7, paddingBottom: space.s6 }}
				>
					{t`Made with Reactive Resume, free and open source`}
				</Text>
			</ScrollView>
			<SafeAreaView
				edges={["bottom", "left", "right"]}
				style={{
					flexDirection: "row",
					gap: space.s2,
					paddingHorizontal: space.s4,
					paddingTop: space.s3,
					paddingBottom: space.s3,
					borderTopWidth: 1,
					borderColor: colors.line,
					backgroundColor: colors.surface,
				}}
			>
				{downloads ? (
					<>
						<View style={{ flex: 1 }}>
							<Button
								label={download.isPending ? t`Downloading…` : t`Download PDF`}
								icon="download-simple"
								loading={download.isPending}
								disabled={download.isPending}
								onPress={() => download.mutate()}
								fullWidth
							/>
						</View>
						<IconButton icon="share-network" label={t`Share`} variant="secondary" onPress={share} />
					</>
				) : (
					<View style={{ flex: 1 }}>
						<Button label={t`Share`} icon="share-network" onPress={share} fullWidth />
					</View>
				)}
			</SafeAreaView>
		</View>
	);
}

type PasswordPromptProps = { username: string; slug: string; onUnlocked: () => void };

/** `resume.verifyPassword` sets the unlock cookie, which `expo/fetch` keeps in the native cookie store (S3 §6). */
function PasswordPrompt({ username, slug, onUnlocked }: PasswordPromptProps) {
	const { t } = useLingui();
	const { colors, radius, space } = useTheme();
	const [password, setPassword] = useState("");
	const [visible, setVisible] = useState(false);
	const [error, setError] = useState<string>();

	const verify = useMutation({
		mutationFn: () => client.resume.verifyPassword({ username, slug, password }),
		onSuccess: onUnlocked,
		onError: (cause) => {
			if (cause instanceof ORPCError && cause.code === "INVALID_PASSWORD")
				setError(t`The password you entered is incorrect. Try again.`);
			else showToast({ message: t`Couldn't verify the password. Try again.` });
		},
	});
	const submit = () => {
		if (password.length < 6 || verify.isPending) return;
		setError(undefined);
		verify.mutate();
	};

	return (
		<ScrollView
			keyboardShouldPersistTaps="handled"
			contentInsetAdjustmentBehavior="automatic"
			style={{ backgroundColor: colors.bg }}
			contentContainerStyle={{ padding: space.s4, paddingTop: space.s6, gap: space.s4 }}
		>
			<Stack.Screen options={{ title: "" }} />
			<View
				style={{
					width: 56,
					height: 56,
					borderRadius: radius.rLg,
					backgroundColor: colors.sunken,
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<Icon name="lock" size={28} color={colors.ink2} />
			</View>
			<Text variant="heading" accessibilityRole="header">
				{t`This resume is password-protected`}
			</Text>
			<Text color="ink2">{t`Enter the password the resume owner shared with you.`}</Text>
			<TextField
				label={t`Password`}
				value={password}
				onChangeText={(value) => {
					setPassword(value);
					setError(undefined);
				}}
				error={error}
				autoFocus
				secureTextEntry={!visible}
				// Someone else's password: keep it out of the keychain and autofill.
				autoComplete="off"
				textContentType="none"
				importantForAutofill="no"
				autoCapitalize="none"
				autoCorrect={false}
				maxLength={64}
				returnKeyType="go"
				onSubmitEditing={submit}
				trailing={
					<IconButton
						icon={visible ? "eye-slash" : "eye"}
						label={visible ? t`Hide password` : t`Show password`}
						onPress={() => setVisible(!visible)}
					/>
				}
			/>
			<Button
				label={verify.isPending ? t`Verifying password…` : t`Unlock`}
				icon="lock-open"
				loading={verify.isPending}
				disabled={password.length < 6 || verify.isPending}
				onPress={submit}
				fullWidth
			/>
		</ScrollView>
	);
}
