import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { CommandItem } from "@reactive-resume/ui/components/command";
import { Icon } from "@reactive-resume/ui/components/icon";
import { Kbd } from "@reactive-resume/ui/components/kbd";
import { useCommandPaletteStore } from "../store";
import { useDialogStore } from "@/dialogs/store";
import { useShortcutSettings } from "@/features/keyboard-shortcuts/settings";

function useGo() {
	const navigate = useNavigate();
	const reset = useCommandPaletteStore((state) => state.reset);
	return async (path: string) => {
		await navigate({ to: path });
		reset();
	};
}

/** Jump to: the sidebar's own places, by the sidebar's own names. */
export function JumpItems() {
	const go = useGo();
	const { session } = useRouteContext({ strict: false });

	return (
		<>
			<CommandItem
				disabled={!session}
				keywords={[t`Today`, t`Needs you`, t`Home`]}
				value="navigation.today"
				onSelect={() => go("/dashboard")}
			>
				<Icon name="house-simple" />
				<Trans>Today</Trans>
			</CommandItem>
			<CommandItem
				disabled={!session}
				keywords={[t`Documents`, t`Resumes`, t`Cover letters`]}
				value="navigation.documents"
				onSelect={() => go("/dashboard/documents")}
			>
				<Icon name="files" />
				<Trans>Documents</Trans>
			</CommandItem>
			<CommandItem
				disabled={!session}
				keywords={[t`Applications`, t`Jobs`]}
				value="navigation.applications"
				onSelect={() => go("/dashboard/applications")}
			>
				<Icon name="briefcase" />
				<Trans>Applications</Trans>
			</CommandItem>
			<CommandItem
				disabled={!session}
				keywords={[t`Career`, t`Coach`, t`Knowledge`, t`Offers`]}
				value="navigation.career"
				onSelect={() => go("/dashboard/career")}
			>
				<Icon name="compass" />
				<Trans>Career</Trans>
			</CommandItem>
			<CommandItem
				disabled={!session}
				keywords={[t`Trash`, t`Deleted`]}
				value="navigation.trash"
				onSelect={() => go("/dashboard/trash")}
			>
				<Icon name="trash" />
				<Trans>Trash</Trans>
			</CommandItem>
			<CommandItem
				disabled={!session}
				keywords={[t`Settings`, t`Account`]}
				value="navigation.settings"
				onSelect={() => go("/dashboard/settings")}
			>
				<Icon name="gear-six" />
				<Trans>Settings</Trans>
			</CommandItem>
		</>
	);
}

/** Create: a resume, a cover letter (both the New document form), a saved job, each with its N chord. */
export function CreateItems({ forceMount = false }: { forceMount?: boolean }) {
	const navigate = useNavigate();
	const { session } = useRouteContext({ strict: false });
	const reset = useCommandPaletteStore((state) => state.reset);
	const characterShortcuts = useShortcutSettings((state) => state.characterShortcuts);
	// The shell binds N R, N L and N J; each key is its own chip, as in the shortcuts list.
	const chord = (key: string) =>
		characterShortcuts ? (
			<span data-slot="command-shortcut" className="ms-auto inline-flex shrink-0 gap-1 max-sm:hidden">
				<Kbd>N</Kbd>
				<Kbd>{key}</Kbd>
			</span>
		) : null;

	return (
		<>
			<CommandItem
				forceMount={forceMount}
				disabled={!session}
				keywords={[t`New document`, t`Create`, t`Import`, t`Resume`]}
				value="navigation.documents.new"
				onSelect={() => {
					reset();
					useDialogStore.getState().openDialog("document.new", undefined);
				}}
			>
				<Icon name="file-text" />
				<Trans>New resume</Trans>
				{chord("R")}
			</CommandItem>
			<CommandItem
				forceMount={forceMount}
				disabled={!session}
				keywords={[t`Cover letter`, t`Letter`, t`Create`]}
				value="navigation.letters.new"
				onSelect={() => {
					reset();
					useDialogStore.getState().openDialog("document.new", { context: "letters" });
				}}
			>
				<Icon name="envelope-simple" />
				<Trans>New cover letter</Trans>
				{chord("L")}
			</CommandItem>
			<CommandItem
				forceMount={forceMount}
				disabled={!session}
				keywords={[t`Save job`, t`New application`, t`Add application`, t`Job`]}
				value="navigation.applications.new"
				onSelect={async () => {
					await navigate({ to: "/dashboard/applications", search: { create: true } });
					reset();
				}}
			>
				<Icon name="bookmark-simple" />
				<Trans>Save a job</Trans>
				{chord("J")}
			</CommandItem>
		</>
	);
}

/** Places with no row in the sidebar. They show as commands once something is typed. */
export function MoreItems() {
	const go = useGo();
	const { session } = useRouteContext({ strict: false });
	const pushPage = useCommandPaletteStore((state) => state.pushPage);

	return (
		<>
			<CommandItem keywords={[t`Home`, t`Website`]} value="navigation.home" onSelect={() => go("/")}>
				<Icon name="house" />
				<Trans>Home page</Trans>
			</CommandItem>
			<CommandItem
				keywords={[t`ATS checker`, t`Check a PDF`]}
				value="navigation.ats-checker"
				onSelect={() => go("/ats-checker")}
			>
				<Icon name="seal-check" />
				<Trans>ATS checker</Trans>
			</CommandItem>

			{session && (
				<>
					{/* Career's own places, so ⌘K reaches them by name. */}
					<CommandItem
						keywords={[t`Coach`, t`Career coach`, t`Chat`]}
						value="navigation.career.coach"
						onSelect={() => go("/dashboard/career/coach")}
					>
						<Icon name="chat-text" />
						<Trans>Coach</Trans>
					</CommandItem>
					<CommandItem
						keywords={[t`Knowledge`, t`Facts`, t`Stories`]}
						value="navigation.career.knowledge"
						onSelect={() => go("/dashboard/career/knowledge/facts")}
					>
						<Icon name="brain" />
						<Trans>Knowledge</Trans>
					</CommandItem>
					<CommandItem
						keywords={[t`Offers`, t`Compare offers`, t`Salary`]}
						value="navigation.career.offers"
						onSelect={() => go("/dashboard/career/offers")}
					>
						<Icon name="scales" />
						<Trans>Offers</Trans>
					</CommandItem>

					{/* The Settings sections. */}
					<CommandItem
						keywords={[
							t`Name`,
							t`Username`,
							t`Photo`,
							t`Password`,
							t`Two-step verification`,
							t`Passkeys`,
							t`Export data`,
							t`Delete account`,
							t`Sign out`,
						]}
						value="navigation.settings.account"
						onSelect={() => go("/dashboard/settings/account")}
					>
						<Icon name="user-circle" />
						<Trans>Account</Trans>
					</CommandItem>
					<CommandItem
						keywords={[t`Profile`, t`Application email`, t`References`, t`Requested salary`]}
						value="navigation.settings.profile"
						onSelect={() => go("/dashboard/settings/profile")}
					>
						<Icon name="clipboard-text" />
						<Trans>Application profile</Trans>
					</CommandItem>
					<CommandItem
						keywords={[t`Theme`, t`Language`, t`Timezone`]}
						value="navigation.settings.preferences"
						onSelect={() => go("/dashboard/settings/preferences")}
					>
						<Icon name="sliders-horizontal" />
						<Trans>Preferences</Trans>
					</CommandItem>
					<CommandItem
						keywords={[t`AI providers`, t`Web access`, t`Usage`]}
						value="navigation.settings.ai"
						onSelect={() => go("/dashboard/settings/ai")}
					>
						<Icon name="sparkle" />
						<Trans>AI</Trans>
					</CommandItem>
					<CommandItem
						keywords={[t`API keys`, t`MCP`, t`Connected applications`, t`Integrations`]}
						value="navigation.settings.developer"
						onSelect={() => go("/dashboard/settings/developer")}
					>
						<Icon name="code" />
						<Trans>Developer</Trans>
					</CommandItem>

					{/* Each kind's full list, searched on a page of its own. */}
					<CommandItem keywords={[t`Resumes`]} value="search.resumes" onSelect={() => pushPage("resumes")}>
						<Icon name="file-text" />
						<Trans>Search resumes</Trans>
					</CommandItem>
					<CommandItem
						keywords={[t`Applications`]}
						value="search.applications"
						onSelect={() => pushPage("applications")}
					>
						<Icon name="briefcase" />
						<Trans>Search applications</Trans>
					</CommandItem>
					<CommandItem
						keywords={[t`Conversations`, t`Assistant`, t`Threads`]}
						value="search.threads"
						onSelect={() => pushPage("threads")}
					>
						<Icon name="chat-text" />
						<Trans>Search assistant conversations</Trans>
					</CommandItem>
				</>
			)}
		</>
	);
}
