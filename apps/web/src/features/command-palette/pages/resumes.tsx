import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { BriefcaseIcon, ChatCircleDotsIcon, PlusIcon, ReadCvLogoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { CommandLoading } from "cmdk";
import { CommandItem, CommandShortcut } from "@reactive-resume/ui/components/command";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { useDialogStore } from "@/dialogs/store";
import { applicationsListQueryOptions } from "@/features/applications/queries";
import { orpc } from "@/libs/orpc/client";
import { useCommandPaletteStore } from "../store";
import { BaseCommandGroup } from "./base";

type Application = RouterOutput["applications"]["list"][number];
type Thread = RouterOutput["agent"]["threads"]["list"][number];
type SearchPage = "resumes" | "applications" | "threads";

const isSearchPage = (page: string | undefined): page is SearchPage =>
	page === "resumes" || page === "applications" || page === "threads";

const matchesSearch = (search: string, values: Array<string | null | undefined>) => {
	const query = search.trim().toLowerCase();
	return !query || values.some((value) => value?.toLowerCase().includes(query));
};

export function ResumesCommandGroup() {
	const navigate = useNavigate();
	const { openDialog } = useDialogStore();
	const { session } = useRouteContext({ strict: false });
	const reset = useCommandPaletteStore((state) => state.reset);
	const peekPage = useCommandPaletteStore((state) => state.peekPage);
	const pushPage = useCommandPaletteStore((state) => state.pushPage);
	const search = useCommandPaletteStore((state) => state.search);

	const commandPage = peekPage();
	const commandSearchPage = isSearchPage(commandPage) ? commandPage : undefined;
	const searchPage = commandSearchPage;

	const { data: resumes, isLoading } = useQuery(
		orpc.resume.list.queryOptions({
			enabled: !!session && searchPage === "resumes",
			input: { sort: "lastUpdatedAt", tags: [] },
		}),
	);
	const { data: applications, isLoading: isLoadingApplications } = useQuery({
		...applicationsListQueryOptions(),
		enabled: !!session && searchPage === "applications",
	});
	const { data: threads, isLoading: isLoadingThreads } = useQuery(
		orpc.agent.threads.list.queryOptions({
			enabled: !!session && searchPage === "threads",
		}),
	);

	const filteredResumes = (resumes ?? []).filter((resume) => matchesSearch(search, [resume.name, resume.slug]));
	const filteredApplications = (applications ?? []).filter((application) =>
		matchesSearch(search, [application.company, application.role]),
	);
	const filteredThreads = (threads ?? []).filter((thread) =>
		matchesSearch(search, [thread.title, thread.resumeName, thread.providerLabel]),
	);

	const onCreate = async () => {
		await navigate({ to: "/dashboard/resumes" });
		openDialog("resume.create", undefined);
		reset();
	};

	const onNavigate = async (path: string) => {
		await navigate({ to: path });
		reset();
	};

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

	const onOpenThread = async (thread: Thread) => {
		await navigate({ to: "/agent/$threadId", params: { threadId: thread.id } });
		reset();
	};

	if (!session) return null;

	return (
		<>
			<BaseCommandGroup heading={<Trans>Search for…</Trans>}>
				<CommandItem keywords={[t`Resumes`]} value="search.resumes" onSelect={() => pushPage("resumes")}>
					<ReadCvLogoIcon />
					<Trans>Resumes</Trans>
				</CommandItem>

				<CommandItem keywords={[t`Applications`]} value="search.applications" onSelect={() => pushPage("applications")}>
					<BriefcaseIcon />
					<Trans>Applications</Trans>
				</CommandItem>

				<CommandItem keywords={[t`Threads`, t`Agent`]} value="search.threads" onSelect={() => pushPage("threads")}>
					<ChatCircleDotsIcon />
					<Trans>Threads</Trans>
				</CommandItem>
			</BaseCommandGroup>

			{searchPage === "resumes" ? (
				<BaseCommandGroup page={commandSearchPage} heading={<Trans>Resumes</Trans>}>
					<CommandItem value="resumes.create" onSelect={onCreate}>
						<PlusIcon />
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
								<ReadCvLogoIcon />
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
			) : null}

			{searchPage === "applications" ? (
				<BaseCommandGroup page={commandSearchPage} heading={<Trans>Applications</Trans>}>
					<CommandItem value="applications.create" onSelect={onCreateApplication}>
						<PlusIcon />
						<Trans>New Application</Trans>
					</CommandItem>

					{isLoadingApplications ? (
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
								<BriefcaseIcon />
								<span className="min-w-0 truncate">{application.company}</span>
								<span className="truncate text-muted-foreground text-xs">{application.role}</span>
							</CommandItem>
						))
					)}
				</BaseCommandGroup>
			) : null}

			{searchPage === "threads" ? (
				<BaseCommandGroup page={commandSearchPage} heading={<Trans>Threads</Trans>}>
					<CommandItem value="threads.create" onSelect={() => onNavigate("/agent/new")}>
						<PlusIcon />
						<Trans>New Thread</Trans>
					</CommandItem>

					{isLoadingThreads ? (
						<CommandLoading>
							<Trans>Loading threads…</Trans>
						</CommandLoading>
					) : (
						filteredThreads.map((thread) => {
							const title = thread.title === thread.resumeName ? t`New thread` : thread.title;
							const resumeName = thread.resumeName ?? "";
							const providerLabel = thread.providerLabel ?? "";

							return (
								<CommandItem
									key={thread.id}
									value={`thread.${thread.id}`}
									keywords={[title, resumeName, providerLabel]}
									onSelect={() => onOpenThread(thread)}
								>
									<ChatCircleDotsIcon />
									<span className="min-w-0 truncate">{title}</span>
									<span className="truncate text-muted-foreground text-xs">{resumeName}</span>
								</CommandItem>
							);
						})
					)}
				</BaseCommandGroup>
			) : null}
		</>
	);
}
