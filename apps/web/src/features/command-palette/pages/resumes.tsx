import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { CommandLoading } from "cmdk";
import { useEffect } from "react";
import { useDebounceValue } from "usehooks-ts";
import { CommandGroup, CommandItem, CommandShortcut } from "@reactive-resume/ui/components/command";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { useCommandPaletteStore } from "../store";
import { BaseCommandGroup } from "./base";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { orpc } from "@/libs/orpc/client";

type Application = RouterOutput["applications"]["listSummary"][number];
type Thread = RouterOutput["agent"]["threads"]["list"][number];
type Document = RouterOutput["documents"]["list"][number];
type SearchPage = "resumes" | "applications" | "threads";
type SearchPageProps = { page: SearchPage };

const isSearchPage = (page: string | undefined): page is SearchPage =>
	page === "resumes" || page === "applications" || page === "threads";

const matchesSearch = (search: string, values: Array<string | null | undefined>) => {
	const query = search.trim().toLowerCase();
	return !query || values.some((value) => value?.toLowerCase().includes(query));
};

/** Results per kind while typing on the first page; Show all opens the kind's own page. */
const PREVIEW = 3;
/** Letters continue into the existing paginated Documents library. */
const LETTER_PREVIEW = 8;

const applicationValues = (application: Application) => [
	application.company,
	application.role,
	application.location,
	...application.tags,
	...application.contacts.map((contact) => contact.name),
];

/**
 * The server searches names, tags and linked applications (never public addresses), and returns only a bounded page:
 * a library of thousands of documents isn't loaded to find a few.
 */
function useDocumentSearch(search: string, type: "resume" | "letter", limit: number, enabled = true) {
	const [q] = useDebounceValue(search.trim().slice(0, 500), 200);
	const query = useQuery({
		...orpc.documents.list.queryOptions({
			input: { type, q, limit, offset: 0, sort: "edited", tags: [], trashed: false },
		}),
		// Typed text waits for its own search; it never fetches the unfiltered list first.
		enabled: enabled && (q !== "" || search.trim() === ""),
		placeholderData: (previous) => previous,
	});
	// Rows for an older query stay hidden: cmdk would still match them on their tags or company.
	const current = q === search.trim().slice(0, 500) && !query.isPlaceholderData;
	return {
		documents: current ? (query.data ?? []) : [],
		loading: !current || query.isLoading,
		error: current && query.isError,
		refetch: query.refetch,
	};
}

const documentKeywords = (document: Document) => [
	document.name,
	...document.tags,
	document.application?.company ?? "",
	document.application?.role ?? "",
];

export function ResumesCommandGroup() {
	const { session } = useRouteContext({ strict: false });
	const peekPage = useCommandPaletteStore((state) => state.peekPage);
	const pushPage = useCommandPaletteStore((state) => state.pushPage);

	const commandPage = peekPage();
	const searchPage = isSearchPage(commandPage) ? commandPage : undefined;

	if (!session) return null;

	return (
		<>
			{commandPage === undefined ? <RootMatches /> : null}
			<BaseCommandGroup heading={<Trans>Search for…</Trans>}>
				<CommandItem keywords={[t`Resumes`]} value="search.resumes" onSelect={() => pushPage("resumes")}>
					<Icon name="file-text" size={16} />
					<Trans>Resumes</Trans>
				</CommandItem>

				<CommandItem keywords={[t`Applications`]} value="search.applications" onSelect={() => pushPage("applications")}>
					<Icon name="briefcase" size={16} />
					<Trans>Applications</Trans>
				</CommandItem>

				<CommandItem
					keywords={[t`Conversations`, t`Assistant`, t`Threads`]}
					value="search.threads"
					onSelect={() => pushPage("threads")}
				>
					<Icon name="chat-text" size={16} />
					<Trans>Assistant conversations</Trans>
				</CommandItem>
			</BaseCommandGroup>

			{searchPage === "resumes" ? <ResumesPage page={searchPage} /> : null}
			{searchPage === "applications" ? <ApplicationsPage page={searchPage} /> : null}
			{searchPage === "threads" ? <ThreadsPage page={searchPage} /> : null}
		</>
	);
}

/** Typing on the first page finds resumes, letters, applications and conversations by name before any command. */
function RootMatches() {
	const navigate = useNavigate();
	const reset = useCommandPaletteStore((state) => state.reset);
	const pushPage = useCommandPaletteStore((state) => state.pushPage);
	const search = useCommandPaletteStore((state) => state.search);
	const typing = search.trim().length > 0;
	const resumes = useDocumentSearch(search, "resume", PREVIEW + 1, typing);
	const letters = useDocumentSearch(search, "letter", LETTER_PREVIEW + 1, typing);
	const { data: applications } = useQuery({ ...applicationsListQueryOptions(), enabled: typing });
	const { data: threads } = useQuery({ ...orpc.agent.threads.list.queryOptions(), enabled: typing });
	const setSelected = useCommandPaletteStore((state) => state.setSelected);
	const matchingApplications = (applications ?? []).filter((application) =>
		matchesSearch(search, applicationValues(application)),
	);
	const matchingThreads = (threads ?? [])
		.filter((thread) => thread.scope === "document")
		.filter((thread) => matchesSearch(search, [thread.title, thread.resumeName, thread.coverLetterName]));
	// Matches load after the typing settles, when cmdk has already highlighted a command; the top match takes over so
	// Enter opens it.
	const topMatch = typing
		? resumes.documents[0]
			? `resume.${resumes.documents[0].id}`
			: letters.documents[0]
				? `letter.${letters.documents[0].id}`
				: matchingApplications[0]
					? `application.${matchingApplications[0].id}`
					: matchingThreads[0]
						? `thread.${matchingThreads[0].id}`
						: undefined
		: undefined;
	useEffect(() => {
		if (topMatch) setSelected(topMatch);
	}, [topMatch, setSelected]);
	if (!typing) return null;

	const openDocument = async (document: Document) => {
		if (document.type === "resume") await navigate({ to: "/builder/$resumeId", params: { resumeId: document.id } });
		else await navigate({ to: "/builder/letter/$coverLetterId", params: { coverLetterId: document.id } });
		reset();
	};
	const openApplication = async (application: Application) => {
		await navigate({ to: "/dashboard/applications", search: { applicationId: application.id } });
		reset();
	};
	// Show all stays visible whatever was typed: it is how the rest of the matches are reached.
	const more = (page: SearchPage, label: string) => (
		<CommandItem forceMount value={`more.${page}`} onSelect={() => pushPage(page)} className="text-ink-2">
			<Icon name="arrow-right" size={16} className="rtl:-scale-x-100" />
			{label}
		</CommandItem>
	);

	return (
		<>
			{resumes.documents.length > 0 && (
				<CommandGroup heading={<Trans>Resumes</Trans>}>
					{resumes.documents.slice(0, PREVIEW).map((document) => (
						<CommandItem
							key={document.id}
							value={`resume.${document.id}`}
							keywords={documentKeywords(document)}
							onSelect={() => void openDocument(document)}
						>
							<Icon name="file-text" size={16} />
							<span className="min-w-0 truncate">{document.name}</span>
							{document.application && (
								<span className="truncate text-xs text-ink-3">{document.application.company}</span>
							)}
						</CommandItem>
					))}
					{resumes.documents.length > PREVIEW && more("resumes", t`Show all resumes`)}
				</CommandGroup>
			)}
			{letters.error && (
				<CommandGroup forceMount heading={<Trans>Letters</Trans>}>
					<CommandItem
						forceMount
						value="retry.letters"
						onSelect={() => {
							void letters.refetch();
						}}
					>
						<Icon name="arrow-clockwise" size={16} />
						<Trans>Couldn't load letters. Try again.</Trans>
					</CommandItem>
				</CommandGroup>
			)}
			{letters.documents.length > 0 && (
				<CommandGroup heading={<Trans>Letters</Trans>}>
					{letters.documents.slice(0, LETTER_PREVIEW).map((document) => (
						<CommandItem
							key={document.id}
							value={`letter.${document.id}`}
							keywords={documentKeywords(document)}
							onSelect={() => void openDocument(document)}
						>
							<Icon name="envelope-simple" size={16} />
							<span className="min-w-0 truncate">{document.name}</span>
							{document.application && (
								<span className="truncate text-xs text-ink-3">{document.application.company}</span>
							)}
						</CommandItem>
					))}
					{letters.documents.length > LETTER_PREVIEW && (
						<CommandItem
							forceMount
							value="more.letters"
							onSelect={async () => {
								await navigate({ to: "/dashboard", search: { type: "letter", q: search.trim().slice(0, 500) } });
								reset();
							}}
							className="text-ink-2"
						>
							<Icon name="arrow-right" size={16} className="rtl:-scale-x-100" />
							<Trans>Show all letters</Trans>
						</CommandItem>
					)}
				</CommandGroup>
			)}
			{matchingApplications.length > 0 && (
				<CommandGroup heading={<Trans>Applications</Trans>}>
					{matchingApplications.slice(0, PREVIEW).map((application) => (
						<CommandItem
							key={application.id}
							value={`application.${application.id}`}
							keywords={applicationValues(application).filter((value): value is string => !!value)}
							onSelect={() => void openApplication(application)}
						>
							<Icon name="briefcase" size={16} />
							<span className="min-w-0 truncate">{application.company}</span>
							<span className="truncate text-xs text-ink-3">{application.role}</span>
						</CommandItem>
					))}
					{matchingApplications.length > PREVIEW && more("applications", t`Show all applications`)}
				</CommandGroup>
			)}
			{matchingThreads.length > 0 && (
				<CommandGroup heading={<Trans>Assistant conversations</Trans>}>
					{matchingThreads.slice(0, PREVIEW).map((thread) => (
						<ThreadItem key={thread.id} thread={thread} onOpen={reset} />
					))}
					{matchingThreads.length > PREVIEW && more("threads", t`Show all conversations`)}
				</CommandGroup>
			)}
		</>
	);
}

function ResumesPage({ page }: SearchPageProps) {
	const navigate = useNavigate();
	const { openDialog } = useDialogStore();
	const reset = useCommandPaletteStore((state) => state.reset);
	const search = useCommandPaletteStore((state) => state.search);
	const { documents: resumes, loading: isLoading } = useDocumentSearch(search, "resume", 100);

	const onCreate = () => {
		reset();
		openDialog("document.new", undefined);
	};

	const onNavigate = async (path: string) => {
		await navigate({ to: path });
		reset();
	};

	return (
		<BaseCommandGroup page={page} heading={<Trans>Resumes</Trans>}>
			<CommandItem value="resumes.create" onSelect={onCreate}>
				<Icon name="plus" size={16} />
				<Trans>Create a new resume</Trans>
			</CommandItem>

			{isLoading ? (
				<CommandLoading>
					<Trans>Loading resumes…</Trans>
				</CommandLoading>
			) : (
				resumes.map((resume) => (
					<CommandItem
						key={resume.id}
						value={`resume.${resume.id}`}
						keywords={documentKeywords(resume)}
						onSelect={() => onNavigate(`/builder/${resume.id}`)}
					>
						<Icon name="file-text" size={16} />
						{resume.name}

						<CommandShortcut className="opacity-0 group-data-[selected=true]/command-item:opacity-100">
							<Trans comment="Command palette hint that pressing Enter opens the selected resume">
								Press <Kbd>Enter</Kbd> to open
							</Trans>
						</CommandShortcut>
					</CommandItem>
				))
			)}
		</BaseCommandGroup>
	);
}

function ApplicationsPage({ page }: SearchPageProps) {
	const navigate = useNavigate();
	const reset = useCommandPaletteStore((state) => state.reset);
	const search = useCommandPaletteStore((state) => state.search);
	const { data: applications, isLoading } = useQuery(applicationsListQueryOptions());
	const filteredApplications = (applications ?? []).filter((application) =>
		matchesSearch(search, applicationValues(application)),
	);

	const onCreateApplication = async () => {
		await navigate({ to: "/dashboard/applications", search: { create: true } });
		reset();
	};

	const onOpenApplication = async (application: Application) => {
		await navigate({
			to: "/dashboard/applications",
			search: { applicationId: application.id },
		});
		reset();
	};

	return (
		<BaseCommandGroup page={page} heading={<Trans>Applications</Trans>}>
			<CommandItem value="applications.create" onSelect={onCreateApplication}>
				<Icon name="plus" size={16} />
				<Trans>Save job</Trans>
			</CommandItem>

			{isLoading ? (
				<CommandLoading>
					<Trans>Loading applications…</Trans>
				</CommandLoading>
			) : (
				filteredApplications.map((application) => (
					<CommandItem
						key={application.id}
						value={`application.${application.id}`}
						keywords={applicationValues(application).filter((value): value is string => !!value)}
						onSelect={() => onOpenApplication(application)}
					>
						<Icon name="briefcase" size={16} />
						<span className="min-w-0 truncate">{application.company}</span>
						<span className="truncate text-xs text-ink-3">{application.role}</span>
					</CommandItem>
				))
			)}
		</BaseCommandGroup>
	);
}

function ThreadsPage({ page }: SearchPageProps) {
	const reset = useCommandPaletteStore((state) => state.reset);
	const search = useCommandPaletteStore((state) => state.search);
	const { data: threads, isLoading } = useQuery(orpc.agent.threads.list.queryOptions());
	const filteredThreads = (threads ?? [])
		.filter((thread) => thread.scope === "document")
		.filter((thread) => matchesSearch(search, [thread.title, thread.resumeName, thread.coverLetterName]));

	return (
		<BaseCommandGroup page={page} heading={<Trans>Assistant conversations</Trans>}>
			{isLoading ? (
				<CommandLoading>
					<Trans>Loading conversations…</Trans>
				</CommandLoading>
			) : (
				filteredThreads.map((thread) => <ThreadItem key={thread.id} thread={thread} onOpen={reset} />)
			)}
		</BaseCommandGroup>
	);
}

type ThreadItemProps = { thread: Thread; onOpen: () => void };

/** A conversation opens its document with the assistant showing it. */
function ThreadItem({ thread, onOpen }: ThreadItemProps) {
	const navigate = useNavigate();
	const documentName = thread.coverLetterName ?? thread.resumeName ?? "";
	const open = async () => {
		if (thread.coverLetterId)
			await navigate({
				to: "/builder/letter/$coverLetterId",
				params: { coverLetterId: thread.coverLetterId },
				search: { assistant: thread.id },
			});
		else if (thread.workingResumeId)
			await navigate({
				to: "/builder/$resumeId",
				params: { resumeId: thread.workingResumeId },
				search: { assistant: thread.id },
			});
		onOpen();
	};

	return (
		<CommandItem value={`thread.${thread.id}`} keywords={[thread.title, documentName]} onSelect={() => void open()}>
			<Icon name="chat-text" size={16} />
			<span className="min-w-0 truncate">{thread.title}</span>
			<span className="truncate text-xs text-ink-3">{documentName}</span>
		</CommandItem>
	);
}
