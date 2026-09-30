import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { CommandLoading } from "cmdk";
import { CommandItem, CommandShortcut } from "@reactive-resume/ui/components/command";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { useCommandPaletteStore } from "../store";
import { BaseCommandGroup } from "./base";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { orpc } from "@/libs/orpc/client";

type Application = RouterOutput["applications"]["list"][number];
type Thread = RouterOutput["agent"]["threads"]["list"][number];
type SearchPage = "resumes" | "applications" | "threads";
type SearchPageProps = { page: SearchPage };

const isSearchPage = (page: string | undefined): page is SearchPage =>
	page === "resumes" || page === "applications" || page === "threads";

const matchesSearch = (search: string, values: Array<string | null | undefined>) => {
	const query = search.trim().toLowerCase();
	return !query || values.some((value) => value?.toLowerCase().includes(query));
};

export function ResumesCommandGroup() {
	const { session } = useRouteContext({ strict: false });
	const peekPage = useCommandPaletteStore((state) => state.peekPage);
	const pushPage = useCommandPaletteStore((state) => state.pushPage);

	const commandPage = peekPage();
	const searchPage = isSearchPage(commandPage) ? commandPage : undefined;

	if (!session) return null;

	return (
		<>
			<BaseCommandGroup heading={<Trans>Search for…</Trans>}>
				<CommandItem keywords={[t`Resumes`]} value="search.resumes" onSelect={() => pushPage("resumes")}>
					<Icon name="description" size={16} />
					<Trans>Resumes</Trans>
				</CommandItem>

				<CommandItem keywords={[t`Applications`]} value="search.applications" onSelect={() => pushPage("applications")}>
					<Icon name="work" size={16} />
					<Trans>Applications</Trans>
				</CommandItem>

				<CommandItem
					keywords={[t`Conversations`, t`Assistant`, t`Threads`]}
					value="search.threads"
					onSelect={() => pushPage("threads")}
				>
					<Icon name="chat" size={16} />
					<Trans>Assistant conversations</Trans>
				</CommandItem>
			</BaseCommandGroup>

			{searchPage === "resumes" ? <ResumesPage page={searchPage} /> : null}
			{searchPage === "applications" ? <ApplicationsPage page={searchPage} /> : null}
			{searchPage === "threads" ? <ThreadsPage page={searchPage} /> : null}
		</>
	);
}

function ResumesPage({ page }: SearchPageProps) {
	const navigate = useNavigate();
	const { openDialog } = useDialogStore();
	const reset = useCommandPaletteStore((state) => state.reset);
	const search = useCommandPaletteStore((state) => state.search);
	const { data: resumes, isLoading } = useQuery(
		orpc.resume.list.queryOptions({ input: { sort: "lastUpdatedAt", tags: [] } }),
	);
	const filteredResumes = (resumes ?? []).filter((resume) => matchesSearch(search, [resume.name, resume.slug]));

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
				<Icon name="add" size={16} />
				<Trans>Create a new resume</Trans>
			</CommandItem>

			{isLoading ? (
				<CommandLoading>
					<Trans>Loading resumes…</Trans>
				</CommandLoading>
			) : (
				filteredResumes.map((resume) => (
					<CommandItem
						key={resume.id}
						value={`resume.${resume.id}`}
						keywords={[resume.name, resume.slug]}
						onSelect={() => onNavigate(`/builder/${resume.id}`)}
					>
						<Icon name="description" size={16} />
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
		matchesSearch(search, [application.company, application.role]),
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
				<Icon name="add" size={16} />
				<Trans>New Application</Trans>
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
						keywords={[application.company, application.role]}
						onSelect={() => onOpenApplication(application)}
					>
						<Icon name="work" size={16} />
						<span className="min-w-0 truncate">{application.company}</span>
						<span className="truncate text-xs text-ink-3">{application.role}</span>
					</CommandItem>
				))
			)}
		</BaseCommandGroup>
	);
}

function ThreadsPage({ page }: SearchPageProps) {
	const navigate = useNavigate();
	const reset = useCommandPaletteStore((state) => state.reset);
	const search = useCommandPaletteStore((state) => state.search);
	const { data: threads, isLoading } = useQuery(orpc.agent.threads.list.queryOptions());
	const filteredThreads = (threads ?? []).filter((thread) =>
		matchesSearch(search, [thread.title, thread.resumeName, thread.coverLetterName]),
	);

	// A conversation opens its document with the assistant showing it.
	const onOpenThread = async (thread: Thread) => {
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
		reset();
	};

	return (
		<BaseCommandGroup page={page} heading={<Trans>Assistant conversations</Trans>}>
			{isLoading ? (
				<CommandLoading>
					<Trans>Loading conversations…</Trans>
				</CommandLoading>
			) : (
				filteredThreads.map((thread) => {
					const documentName = thread.coverLetterName ?? thread.resumeName ?? "";

					return (
						<CommandItem
							key={thread.id}
							value={`thread.${thread.id}`}
							keywords={[thread.title, documentName]}
							onSelect={() => onOpenThread(thread)}
						>
							<Icon name="chat" size={16} />
							<span className="min-w-0 truncate">{thread.title}</span>
							<span className="truncate text-xs text-ink-3">{documentName}</span>
						</CommandItem>
					);
				})
			)}
		</BaseCommandGroup>
	);
}
