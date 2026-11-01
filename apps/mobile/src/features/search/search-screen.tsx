import type { RouterOutput } from "@/api/client";
import type { DocumentSummary } from "@/features/documents/filter";
import type { IconName, ThemePreference } from "@/ui";
import type { Href } from "expo-router";
import { useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { rank } from "./rank";
import { client, orpc } from "@/api/client";
import { getAccountScope, useSession } from "@/auth/session";
import { useApplications } from "@/features/applications/queries";
import { routes } from "@/routes";
import { useIsTablet } from "@/shell/use-is-tablet";
import {
	Banner,
	Button,
	EmptyState,
	Icon,
	IconButton,
	ListRow,
	Text,
	setThemePreference,
	showToast,
	useTheme,
} from "@/ui";

type Page = "root" | "resumes" | "applications" | "threads" | "theme";
type Thread = RouterOutput["agent"]["threads"]["list"][number];
type Row = { key: string; icon: IconName; title: string; subtitle?: string | undefined; onPress: () => void };
type Group = {
	key: string;
	heading: string;
	rows: Row[];
	more?: Page | undefined;
	loading?: string | undefined;
	error?: boolean | undefined;
	retry?: (() => unknown) | undefined;
};

/** Results per kind while typing on the first page; "Show all" opens the kind's own page. */
const PREVIEW = 3;

function useThreads(enabled: boolean) {
	const session = useSession();
	const options = orpc.agent.threads.list.queryOptions({ input: {} });
	return useQuery({
		...options,
		queryKey: [...options.queryKey, session.server],
		enabled: enabled && session.status === "signed-in",
	});
}

function useDocumentSearch(search: string, type: "resume" | "letter", limit: number, enabled: boolean) {
	const session = useSession();
	const scope = getAccountScope();
	const text = search.trim().slice(0, 500);
	const [q, setQ] = useState(text);
	useEffect(() => {
		const timer = setTimeout(() => setQ(text), 200);
		return () => clearTimeout(timer);
	}, [text]);
	const options = orpc.documents.list.queryOptions({
		input: { q, type, limit, offset: 0, sort: "edited", tags: [], trashed: false },
	});
	const query = useQuery({
		...options,
		queryKey: [...options.queryKey, scope],
		enabled: enabled && session.status === "signed-in" && q === text,
	});
	return { ...query, data: q === text ? query.data : undefined, isPending: q !== text || query.isPending };
}

/**
 * The command palette as a full-screen search: documents, applications, assistant conversations and actions, grouped
 * by kind. "Search for…" rows open one kind's list, as web's palette pages do; Ask is always last.
 */
export function SearchScreen() {
	const { t } = useLingui();
	const router = useRouter();
	const { colors, radius, size, space, type } = useTheme();
	const tablet = useIsTablet();
	const session = useSession();
	const signedIn = session.status === "signed-in";
	const [query, setQuery] = useState("");
	const [page, setPage] = useState<Page>("root");
	const typing = query.trim().length > 0;

	const resumeQuery = useDocumentSearch(
		query,
		"resume",
		page === "resumes" ? 100 : PREVIEW + 1,
		typing || page === "resumes",
	);
	const letterQuery = useDocumentSearch(query, "letter", 9, typing && page === "root");
	const applications = useApplications();
	const threads = useThreads(typing || page === "threads");

	// Search is a modal: leave it for the destination, back to an open tab when the destination is one.
	const go = (href: Href) => router.dismissTo(href);
	const open = (next: Page) => {
		setPage(next);
		setQuery("");
	};
	// Back clears the field, then leaves a scoped page, then closes: web's Backspace order.
	const back = () => {
		if (query) setQuery("");
		else if (page !== "root") setPage("root");
		else return false;
		return true;
	};
	useEffect(() => {
		const subscription = BackHandler.addEventListener("hardwareBackPress", back);
		return () => subscription.remove();
	});
	const onKey = (key: string) => {
		if (key === "Backspace" && !query && page !== "root") setPage("root");
	};

	const documentRow = (document: DocumentSummary): Row => ({
		key: `${document.type}:${document.id}`,
		icon: document.type === "resume" ? "file-text" : "envelope-simple",
		title: document.name,
		subtitle: document.application ? t`Linked to ${document.application.company}` : undefined,
		onPress: () => go(document.type === "resume" ? routes.builder(document.id) : routes.letter(document.id)),
	});
	const applicationRow = (application: NonNullable<typeof applications.data>[number]): Row => ({
		key: `application:${application.id}`,
		icon: "briefcase",
		title: application.company,
		subtitle: application.role,
		onPress: () => go(routes.application(application.id)),
	});
	const threadRow = (thread: Thread): Row => ({
		key: `thread:${thread.id}`,
		icon: "chat-text",
		title: thread.title,
		subtitle: thread.coverLetterName ?? thread.resumeName ?? undefined,
		onPress: () => {
			// Preserve the selected conversation and its owning document.
			if (thread.coverLetterId)
				go({ pathname: routes.letterAssistant(thread.coverLetterId), params: { thread: thread.id } });
			else if (thread.workingResumeId)
				go({ pathname: routes.assistant(thread.workingResumeId), params: { thread: thread.id } });
		},
	});

	const resumes = resumeQuery.data ?? [];
	const letters = letterQuery.data ?? [];
	const jobs = (applications.data ?? []).map((application) => ({
		...application,
		title: application.company,
		keywords: [
			application.role,
			application.location,
			...application.tags,
			...application.contacts.map((contact) => contact.name),
		],
		time: application.updatedAt.getTime(),
	}));
	const conversations = (threads.data ?? [])
		.filter((thread) => thread.scope === "document")
		.map((thread) => ({
			...thread,
			keywords: [thread.resumeName, thread.coverLetterName],
			time: thread.lastMessageAt.getTime(),
		}));

	const actions: (Row & { keywords: string[]; account?: boolean; root?: boolean })[] = [
		{
			key: "new",
			icon: "plus",
			title: t`New document`,
			keywords: [t`Create`, t`Import`, t`Resumes`, t`Cover letters`],
			account: true,
			root: true,
			onPress: () => go(routes.new()),
		},
		{
			key: "trash",
			icon: "trash",
			title: t`Trash`,
			keywords: [t`Deleted`],
			account: true,
			root: true,
			onPress: () => go(routes.trash()),
		},
		{
			key: "ats",
			icon: "seal-check",
			title: t`ATS checker`,
			keywords: [t`Check a PDF`],
			root: true,
			onPress: () => go(routes.atsChecker()),
		},
		{
			key: "new-application",
			icon: "briefcase",
			title: t`Save job`,
			keywords: [t`New application`, t`Add application`, t`Job`],
			account: true,
			root: true,
			onPress: () => go(routes.newJob()),
		},
		{
			key: "settings",
			icon: "gear-six",
			title: t`Settings`,
			keywords: [],
			account: true,
			root: true,
			onPress: () => go(routes.settings()),
		},
		{
			key: "documents",
			icon: "file-text",
			title: t`Documents`,
			keywords: [t`Resumes`, t`Cover letters`],
			account: true,
			onPress: () => go(routes.documents()),
		},
		{
			key: "applications",
			icon: "briefcase",
			title: t`Applications`,
			keywords: [t`Jobs`],
			account: true,
			onPress: () => go(routes.applications()),
		},
		{
			key: "account",
			icon: "user-circle",
			title: t`Account`,
			keywords: [t`Profile`, t`Password`, t`Passkeys`, t`Export data`, t`Delete account`],
			account: true,
			onPress: () => go(routes.settings("account")),
		},
		{
			key: "preferences",
			icon: "sliders-horizontal",
			title: t`Preferences`,
			keywords: [t`Theme`, t`Language`],
			account: true,
			onPress: () => go(routes.settings("preferences")),
		},
		{
			key: "ai",
			icon: "key",
			title: t`AI & developer`,
			keywords: [t`AI providers`, t`API keys`, t`MCP`],
			account: true,
			onPress: () => go(routes.settings("ai")),
		},
		{
			key: "theme",
			icon: "circle-half",
			title: t`Change theme to…`,
			keywords: [t`Theme`, t`Dark theme`, t`Light theme`],
			root: true,
			onPress: () => open("theme"),
		},
		{
			key: "language",
			icon: "translate",
			title: t`Change language to…`,
			keywords: [t`Language`],
			account: true,
			root: true,
			onPress: () => go(routes.settings("preferences")),
		},
	];
	const available = actions.filter((action) => signedIn || !action.account);

	const ask = async (question: string) => {
		const scope = getAccountScope();
		let latest: DocumentSummary | undefined;
		try {
			[latest] = await client.documents.list({
				type: "resume",
				sort: "edited",
				limit: 1,
				offset: 0,
				tags: [],
				trashed: false,
			});
		} catch {
			showToast({ message: t`Couldn't load this. Check your connection and try again.` });
			return;
		}
		if (scope !== getAccountScope()) return;
		if (!latest) {
			showToast({ message: t`Create a resume first, then ask about it.` });
			return;
		}
		// M6-T3's assistant route: `?ask=` sends the question in a new conversation.
		go({ pathname: routes.assistant(latest.id), params: { ask: question } });
	};

	const setTheme = (value: ThemePreference) => {
		setThemePreference(value);
		router.back();
	};

	const groups: Group[] = [];
	const loading = (pending: boolean, label: string) => (pending ? label : undefined);
	if (page === "theme") {
		groups.push({
			key: "theme",
			heading: t`Theme`,
			rows: (
				[
					{ key: "light", icon: "sun", title: t`Light theme`, onPress: () => setTheme("light") },
					{ key: "dark", icon: "moon", title: t`Dark theme`, onPress: () => setTheme("dark") },
					{ key: "system", icon: "circle-half", title: t`Match system theme`, onPress: () => setTheme("system") },
				] satisfies Row[]
			).filter((row) => rank(query, [row]).length > 0),
		});
	} else if (page === "resumes") {
		groups.push({
			key: "resumes",
			heading: t`Resumes`,
			rows: [
				{ key: "create", icon: "plus", title: t`Create a new resume`, onPress: () => go(routes.new()) },
				...resumes.map(documentRow),
			],
			loading: loading(resumeQuery.isPending, t`Loading resumes…`),
		});
	} else if (page === "applications") {
		groups.push({
			key: "applications",
			heading: t`Applications`,
			rows: [
				{ key: "create", icon: "plus", title: t`Save job`, onPress: () => go(routes.newJob()) },
				...rank(query, jobs).map(applicationRow),
			],
			loading: loading(applications.isPending, t`Loading applications…`),
		});
	} else if (page === "threads") {
		groups.push({
			key: "threads",
			heading: t`Assistant conversations`,
			rows: rank(query, conversations).map(threadRow),
			loading: loading(threads.isPending, t`Loading conversations…`),
		});
	} else if (!typing) {
		if (signedIn)
			groups.push({
				key: "search-for",
				heading: t`Search for…`,
				rows: [
					{ key: "resumes", icon: "file-text", title: t`Resumes`, onPress: () => open("resumes") },
					{ key: "applications", icon: "briefcase", title: t`Applications`, onPress: () => open("applications") },
					{ key: "threads", icon: "chat-text", title: t`Assistant conversations`, onPress: () => open("threads") },
				],
			});
		groups.push({
			key: "go-to",
			heading: t`Go to…`,
			rows: available.filter((action) => action.root && action.key !== "theme" && action.key !== "language"),
		});
		groups.push({
			key: "preferences",
			heading: t`Preferences`,
			rows: available.filter((action) => action.key === "theme" || action.key === "language"),
		});
	} else {
		const kinds: [string, string, Row[], Page | undefined][] = [
			["resumes", t`Resumes`, resumes.map(documentRow), "resumes"],
			["letters", t`Letters`, letters.slice(0, 8).map(documentRow), undefined],
			["applications", t`Applications`, rank(query, jobs).map(applicationRow), "applications"],
			["threads", t`Assistant conversations`, rank(query, conversations).map(threadRow), "threads"],
			["actions", t`Actions`, rank(query, available), undefined],
		];
		for (const [key, heading, rows, more] of kinds) {
			const source = key === "resumes" ? resumeQuery : key === "letters" ? letterQuery : undefined;
			if (key === "letters" && letters.length > 8)
				rows.push({
					key: "more.letters",
					icon: "arrow-right",
					title: t`Show all letters`,
					onPress: () =>
						go({ pathname: routes.documents(), params: { q: query.trim().slice(0, 500), type: "letter" } }),
				});
			if (rows.length === 0 && !source?.isPending && !source?.isError) continue;
			const capped = key !== "letters" && key !== "actions" && rows.length > PREVIEW;
			groups.push({
				key,
				heading,
				rows: capped ? rows.slice(0, PREVIEW) : rows,
				more: capped ? more : undefined,
				loading: source?.isPending ? t`Loading…` : undefined,
				error: source?.isError,
				retry: source?.refetch,
			});
		}
	}

	const results = groups.some((group) => group.rows.length > 0 || group.loading || group.error);
	const question = query.trim();
	const showAsk = signedIn && question.length > 0 && page !== "theme";
	const first = groups.flatMap((group) => group.rows)[0];

	return (
		<View style={{ flex: 1, backgroundColor: colors.bg }}>
			{/* Tablet: a centred form sheet over the library (app.html Q1). Android keeps the full-screen modal. */}
			<Stack.Screen
				options={{ headerShown: false, presentation: Platform.OS === "ios" && tablet ? "formSheet" : "modal" }}
			/>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space.s2,
					paddingHorizontal: space.s3,
					paddingTop: space.s3,
					paddingBottom: space.s2,
				}}
			>
				<View
					style={{
						flex: 1,
						flexDirection: "row",
						alignItems: "center",
						gap: space.s2,
						minHeight: size.input,
						paddingHorizontal: space.s3,
						borderRadius: radius.rLg,
						backgroundColor: colors.sunken,
					}}
				>
					<Icon name="magnifying-glass" size={size.icon.row} color={colors.ink3} />
					<TextInput
						autoFocus
						value={query}
						onChangeText={setQuery}
						onKeyPress={(event) => onKey(event.nativeEvent.key)}
						onSubmitEditing={() => (first ? first.onPress() : showAsk ? ask(question) : undefined)}
						placeholder={page === "root" ? t`Type a command or search…` : t`Search…`}
						placeholderTextColor={colors.ink3}
						accessibilityLabel={t`Search commands`}
						returnKeyType="search"
						autoCorrect={false}
						autoCapitalize="none"
						clearButtonMode="while-editing"
						style={[type.bodyLarge, { flex: 1, color: colors.ink, paddingVertical: space.s2 }]}
					/>
				</View>
				{page === "root" ? (
					<Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={space.s2}>
						<Text variant="label" color="accentText">
							{t`Cancel`}
						</Text>
					</Pressable>
				) : (
					<IconButton icon="arrow-left" label={t`Back`} onPress={() => void back()} />
				)}
			</View>

			<ScrollView
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="on-drag"
				contentInsetAdjustmentBehavior="automatic"
			>
				{!results && typing ? (
					<EmptyState
						icon="magnifying-glass"
						title={t`No commands match that search.`}
						message={t`Search covers documents, applications, assistant conversations and actions.`}
					/>
				) : null}
				{groups.map((group) =>
					group.rows.length > 0 || group.loading || group.error ? (
						<View key={group.key} style={{ paddingTop: space.s3 }}>
							<Text variant="caption" color="ink3" style={{ paddingHorizontal: space.s4, paddingBottom: space.s1 }}>
								{group.heading}
							</Text>
							{group.rows.map((row) => (
								<ListRow
									key={row.key}
									leading={row.icon}
									title={row.title}
									subtitle={row.subtitle}
									onPress={row.onPress}
								/>
							))}
							{group.loading ? (
								<View
									accessibilityLabel={group.loading}
									style={{ flexDirection: "row", gap: space.s2, padding: space.s4, alignItems: "center" }}
								>
									<ActivityIndicator color={colors.ink3} />
									<Text variant="callout" color="ink3">
										{group.loading}
									</Text>
								</View>
							) : null}
							{group.error ? (
								<>
									<Banner tone="danger" message={t`Couldn't load this. Check your connection and try again.`} />
									<Button
										label={t`Retry`}
										variant="secondary"
										onPress={() => {
											void group.retry?.();
										}}
									/>
								</>
							) : null}
							{group.more ? (
								<ListRow
									title={t`Show all`}
									leading="list-bullets"
									chevron
									onPress={() => setPage(group.more ?? "root")}
								/>
							) : null}
						</View>
					) : null,
				)}
				{showAsk ? (
					<View style={{ paddingTop: space.s3 }}>
						<Text variant="caption" color="ink3" style={{ paddingHorizontal: space.s4, paddingBottom: space.s1 }}>
							{t`Ask`}
						</Text>
						<ListRow leading="sparkle" title={t`Ask the assistant “${question}”`} onPress={() => ask(question)} />
					</View>
				) : null}
			</ScrollView>
		</View>
	);
}
