import { t } from "@lingui/core/macro";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Keyboard, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { editedLabel } from "./display";
import { documentHref } from "./model";
import { searchGroup } from "./search-model";
import { CollectionState, DocumentPlaceholders } from "./shared";
import { useDataBackend, useSearch, useToday } from "@/data";
import { STORYBOARD } from "@/dev/storyboard/harness";
import {
	Chip,
	Dialog,
	DocThumb,
	IconTile,
	ListRow,
	Monogram,
	PushScreen,
	SectionHeading,
	TextField,
	TextLink,
	haptic,
} from "@/ui";

export function SearchScreen() {
	const { scope } = useDataBackend();
	return <ScopedSearchScreen key={scope} />;
}

function ScopedSearchScreen() {
	const params = useLocalSearchParams<{ q?: string }>();
	const [query, setQuery] = useState(params.q ?? "");
	const [debounced, setDebounced] = useState(query);
	const [kind, setKind] = useState("all");
	const [tag, setTag] = useState("");
	const [sort, setSort] = useState("edited");
	const [picker, setPicker] = useState<"kind" | "tag" | "sort" | null>(null);
	const [allDocuments, setAllDocuments] = useState(false);
	const [allApplications, setAllApplications] = useState(false);
	const [expanded, setExpanded] = useState<string[]>([]);
	const search = useSearch(debounced, [
		{ id: "settings", label: t`Settings`, href: "/settings" },
		{ id: "account", label: t`Account and security`, href: "/settings/account" },
		{ id: "preferences", label: t`Preferences`, href: "/settings/preferences" },
		{ id: "profile", label: t`Application profile`, href: "/settings/profile" },
		{ id: "ai", label: t`AI and developer`, href: "/settings/ai" },
		{ id: "facts", label: t`Knowledge`, href: "/career/knowledge/facts" },
		{ id: "offers", label: t`Compare offers`, href: "/career/offers" },
		{ id: "ats", label: t`ATS checker`, href: "/ats-checker" },
		{ id: "trash", label: t`Trash`, href: "/trash" },
		{ id: "letter", label: t`New cover letter`, href: "/new?kind=letter" },
		{ id: "job", label: t`Save a job`, href: "/applications/new" },
	]);
	const recent = search.recent.data ?? [];
	const { now } = useToday();
	const router = useRouter();
	const insets = useSafeAreaInsets();
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(query.trim()), 250);
		return () => clearTimeout(timer);
	}, [query]);
	const remember = () => {
		if (query.trim()) void search.recent.add(query.trim());
		Keyboard.dismiss();
	};
	const documents = (search.documents.data ?? [])
		.filter((doc) => (kind === "all" || kind === doc.type) && (!tag || doc.tags.includes(tag)))
		.toSorted((a, b) =>
			sort === "name"
				? a.name.localeCompare(b.name)
				: sort === "created"
					? b.createdAt.getTime() - a.createdAt.getTime()
					: b.editedAt.getTime() - a.editedAt.getTime(),
		);
	const applications = kind === "all" || kind === "application" ? (search.applications.data ?? []) : [];
	// No hook searches drafted messages yet; the fixture's one draft stands in until the data layer exposes them.
	const { backend } = useDataBackend();
	const extraGroups =
		backend.kind === "fake"
			? []
			: [
					{
						id: "conversations",
						title: t`Conversations`,
						rows: search.conversations.data
							.filter((thread) => thread.scope === "career")
							.map((thread) => ({ id: thread.id, title: thread.title, href: `/career/coach/${thread.id}` })),
					},
					{
						id: "notes",
						title: t`Notes and messages`,
						rows: search.notes.data
							.filter((note) => note.applicationId)
							.map((note) => ({ id: note.id, title: note.title, href: `/applications/${note.applicationId}/library` })),
					},
					{
						id: "application-notes",
						title: t`Application notes`,
						rows: search.applicationNotes.map((app) => ({
							id: app.id,
							title: app.company,
							href: `/applications/${app.id}/messages`,
						})),
					},
					{
						id: "commands",
						title: t`Go to…`,
						rows: search.commands.map((command) => ({ id: command.id, title: command.label, href: command.href })),
					},
				];
	const messages = (
		backend.kind === "fake"
			? [{ id: "lumen-thanks", title: t`Thank-you note to Priya`, detail: t`Draft · Lumen`, applicationId: "lumen" }]
			: []
	).filter(
		(message) =>
			!!debounced && `${message.title} ${message.detail}`.toLocaleLowerCase().includes(debounced.toLocaleLowerCase()),
	);
	const tags = [...new Set(search.documents.data?.flatMap((doc) => doc.tags) ?? [])];
	const kinds = [
		{ label: t`All kinds`, value: "all" },
		{ label: t`Resumes`, value: "resume" },
		{ label: t`Cover letters`, value: "letter" },
		{ label: t`Applications`, value: "application" },
	];
	const sorts = [
		{ label: t`Last edited`, value: "edited" },
		{ label: t`Name`, value: "name" },
		{ label: t`Created`, value: "created" },
	];
	const options =
		picker === "kind"
			? kinds
			: picker === "sort"
				? sorts
				: [{ label: t`Any tag`, value: "" }, ...tags.map((value) => ({ label: value, value }))];
	return (
		<View style={{ flex: 1 }}>
			<PushScreen
				back="none"
				overlay={
					<View
						style={{
							position: "absolute",
							top: insets.top + 6,
							left: 24,
							right: 12,
							flexDirection: "row",
							alignItems: "center",
							gap: 12,
						}}
					>
						<View style={{ flex: 1 }}>
							<TextField
								value={query}
								onChangeText={setQuery}
								placeholder={t`Search everything`}
								leadingIcon="magnifying-glass"
								// Storyboard captures arrive with a query and draw the field focused without a keyboard.
								autoFocus={!STORYBOARD || params.q === undefined}
								forceFocus
								returnKeyType="search"
								onSubmitEditing={remember}
								accessibilityLabel={t`Search everything`}
							/>
						</View>
						<View>
							<TextLink label={t`Cancel`} onPress={() => router.back()} />
						</View>
					</View>
				}
			>
				<View style={{ marginHorizontal: 24, marginTop: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
					<Chip
						label={kinds.find((item) => item.value === kind)?.label ?? t`All kinds`}
						trailingIcon="caret-down"
						onPress={() => setPicker("kind")}
					/>
					<Chip label={tag || t`Any tag`} trailingIcon="caret-down" onPress={() => setPicker("tag")} />
					<Chip
						label={sorts.find((item) => item.value === sort)?.label ?? t`Last edited`}
						trailingIcon="caret-down"
						onPress={() => setPicker("sort")}
					/>
				</View>
				{!debounced ? (
					<>
						<SectionHeading title={t`Recent searches`} first />
						{recent.map((term) => (
							<ListRow
								wrapTitle
								wrapSecondary
								key={term}
								title={term}
								onPress={() => setQuery(term)}
								trailingAction
								trailing={
									<TextLink
										label={t`Remove`}
										onPress={() => {
											void search.recent.remove(term);
											haptic("selection");
										}}
									/>
								}
							/>
						))}
						<SectionHeading title={t`Jump to`} />
						<ListRow
							wrapTitle
							wrapSecondary
							title={t`Trash`}
							leading={<IconTile icon="trash" />}
							trailing="caret"
							onPress={() => router.push("/trash")}
						/>
						<ListRow
							wrapTitle
							wrapSecondary
							title={t`Settings`}
							leading={<IconTile icon="user-circle" />}
							trailing="caret"
							onPress={() => router.push("/settings")}
						/>
						<ListRow
							wrapTitle
							wrapSecondary
							title={t`Insights`}
							leading={<IconTile icon="chart-line-up" />}
							trailing="caret"
							onPress={() => router.push("/applications/insights")}
							last
						/>
					</>
				) : search.documents.isPending || search.applications.isPending ? (
					<DocumentPlaceholders />
				) : (
					<>
						{search.documents.isError || search.applications.isError ? (
							<CollectionState
								message={t`Connect to search everything.`}
								action={t`Retry`}
								onPress={() => {
									void search.documents.refetch();
									void search.applications.refetch();
								}}
							/>
						) : null}
						{applications.length ? (
							<>
								<SectionHeading title={t`Applications`} first />
								{applications.slice(0, allApplications ? undefined : 3).map((app, index) => (
									<ListRow
										wrapTitle
										wrapSecondary
										key={app.id}
										title={app.company}
										secondary={`${app.role} · ${app.status === "interview" ? t`Interviewing` : app.status}`}
										leading={<Monogram letters={app.company.slice(0, 2).toUpperCase()} />}
										trailing="caret"
										last={index === Math.min(applications.length, allApplications ? applications.length : 3) - 1}
										onPress={() => {
											remember();
											router.push(`/applications/${app.id}`);
										}}
									/>
								))}
								{applications.length > 3 && !allApplications ? (
									<ListRow
										wrapTitle
										wrapSecondary
										title={t`Show all ${applications.length}`}
										onPress={() => setAllApplications(true)}
										last
									/>
								) : null}
							</>
						) : null}
						{documents.length ? (
							<>
								<SectionHeading title={t`Documents`} first={!applications.length} />
								{documents.slice(0, allDocuments ? undefined : 3).map((doc, index) => (
									<ListRow
										wrapTitle
										wrapSecondary
										key={doc.id}
										title={doc.name}
										secondary={`${doc.type === "resume" ? t`Resume` : t`Cover letter`} · ${editedLabel(doc.editedAt, now).toLocaleLowerCase()}`}
										leading={<DocThumb letter={doc.type === "letter"} />}
										trailing="caret"
										last={index === Math.min(documents.length, allDocuments ? documents.length : 3) - 1}
										onPress={() => {
											remember();
											router.push(documentHref(doc));
										}}
									/>
								))}
								{documents.length > 3 && !allDocuments ? (
									<ListRow
										wrapTitle
										wrapSecondary
										title={t`Show all ${documents.length}`}
										onPress={() => setAllDocuments(true)}
										last
									/>
								) : null}
							</>
						) : null}
						{messages.length ? (
							<>
								<SectionHeading title={t`Notes and messages`} first={!applications.length && !documents.length} />
								{messages.map((message, index) => (
									<ListRow
										key={message.id}
										title={message.title}
										secondary={message.detail}
										leading={<IconTile icon="envelope-simple" />}
										trailing="caret"
										last={index === messages.length - 1}
										onPress={() => {
											remember();
											router.push(`/applications/${message.applicationId}/messages`);
										}}
									/>
								))}
							</>
						) : null}
						{extraGroups.map((group) => {
							const result = searchGroup(group.rows, expanded.includes(group.id));
							return group.rows.length ? (
								<View key={group.id}>
									<SectionHeading title={group.title} />
									{result.visible.map((row) => (
										<ListRow
											key={row.id}
											title={row.title}
											trailing="caret"
											onPress={() => {
												remember();
												router.push(row.href);
											}}
										/>
									))}
									{result.remaining ? (
										<ListRow
											title={t`Show all ${group.rows.length}`}
											onPress={() => setExpanded((ids) => [...ids, group.id])}
										/>
									) : null}
								</View>
							) : null;
						})}
						{!applications.length &&
						!documents.length &&
						!messages.length &&
						!extraGroups.some((group) => group.rows.length) ? (
							<CollectionState message={t`No matches for “${debounced}”. Try different words.`} />
						) : null}
					</>
				)}
			</PushScreen>
			<Dialog
				open={!!picker}
				onClose={() => setPicker(null)}
				title={picker === "kind" ? t`Kind` : picker === "tag" ? t`Tag` : t`Sort`}
				actions={[
					...options.map((option) => ({
						label: option.label,
						tone: "secondary" as const,
						onPress: () => {
							if (picker === "kind") setKind(option.value);
							else if (picker === "tag") setTag(option.value);
							else setSort(option.value);
							setPicker(null);
						},
					})),
					{ label: t`Cancel`, tone: "secondary", onPress: () => setPicker(null) },
				]}
			/>
		</View>
	);
}
