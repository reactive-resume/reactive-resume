import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useNavigate, useRouteContext } from "@tanstack/react-router";
import { CommandItem } from "@reactive-resume/ui/components/command";
import { Icon } from "@reactive-resume/ui/components/icon";
import { useCommandPaletteStore } from "../store";
import { BaseCommandGroup } from "./base";
import { useDialogStore } from "@/dialogs/store";

export function NavigationCommandGroup() {
	const navigate = useNavigate();
	const { session } = useRouteContext({ strict: false });
	const reset = useCommandPaletteStore((state) => state.reset);
	const pushPage = useCommandPaletteStore((state) => state.pushPage);

	const onNavigate = async (path: string) => {
		await navigate({ to: path });
		reset();
	};

	return (
		<>
			<BaseCommandGroup heading={<Trans>Go to…</Trans>}>
				<CommandItem keywords={[t`Home`]} value="navigation.home" onSelect={() => onNavigate("/")}>
					<Icon name="house" size={16} />
					<Trans>Home</Trans>
				</CommandItem>

				<CommandItem
					disabled={!session}
					keywords={[t`Documents`, t`Resumes`, t`Cover letters`]}
					value="navigation.documents"
					onSelect={() => onNavigate("/dashboard")}
				>
					<Icon name="file-text" size={16} />
					<Trans>Documents</Trans>
				</CommandItem>

				<CommandItem
					disabled={!session}
					keywords={[t`New document`, t`Create`, t`Import`]}
					value="navigation.documents.new"
					onSelect={() => {
						reset();
						useDialogStore.getState().openDialog("document.new", undefined);
					}}
				>
					<Icon name="plus" size={16} />
					<Trans>New document</Trans>
				</CommandItem>

				<CommandItem
					disabled={!session}
					keywords={[t`Trash`, t`Deleted`]}
					value="navigation.trash"
					onSelect={() => onNavigate("/dashboard/trash")}
				>
					<Icon name="trash" size={16} />
					<Trans>Trash</Trans>
				</CommandItem>

				<CommandItem
					keywords={[t`ATS checker`, t`Check a PDF`]}
					value="navigation.ats-checker"
					onSelect={() => onNavigate("/ats-checker")}
				>
					<Icon name="seal-check" size={16} />
					<Trans>ATS checker</Trans>
				</CommandItem>

				<CommandItem
					disabled={!session}
					keywords={[t`Applications`, t`Jobs`]}
					value="navigation.applications"
					onSelect={() => onNavigate("/dashboard/applications")}
				>
					<Icon name="briefcase" size={16} />
					<Trans>Applications</Trans>
				</CommandItem>

				<CommandItem
					disabled={!session}
					keywords={[t`Save job`, t`New application`, t`Add application`, t`Job`]}
					value="navigation.applications.new"
					onSelect={async () => {
						await navigate({ to: "/dashboard/applications", search: { create: true } });
						reset();
					}}
				>
					<Icon name="plus" size={16} />
					<Trans>Save job</Trans>
				</CommandItem>

				<CommandItem
					disabled={!session}
					keywords={[t`Settings`]}
					value="navigation.settings"
					onSelect={() => pushPage("settings")}
				>
					<Icon name="gear-six" size={16} />
					<Trans>Settings</Trans>
				</CommandItem>
			</BaseCommandGroup>

			<BaseCommandGroup page="settings" heading={<Trans>Settings</Trans>}>
				<CommandItem
					keywords={[
						t`Name`,
						t`Username`,
						t`Photo`,
						t`Account`,
						t`Password`,
						t`Two-step verification`,
						t`Passkeys`,
						t`Export data`,
						t`Delete account`,
					]}
					value="navigation.settings.account"
					onSelect={() => onNavigate("/dashboard/settings/account")}
				>
					<Icon name="user-circle" size={16} />
					<Trans>Account</Trans>
				</CommandItem>

				<CommandItem
					keywords={[t`Profile`, t`Application email`, t`References`, t`Requested salary`]}
					value="navigation.settings.profile"
					onSelect={() => onNavigate("/dashboard/settings/profile")}
				>
					<Icon name="clipboard-text" size={16} />
					<Trans>Profile</Trans>
				</CommandItem>

				<CommandItem
					keywords={[t`Preferences`, t`Theme`, t`Language`]}
					value="navigation.settings.preferences"
					onSelect={() => onNavigate("/dashboard/settings/preferences")}
				>
					<Icon name="gear-six" size={16} />
					<Trans>Preferences</Trans>
				</CommandItem>

				<CommandItem
					keywords={[t`AI & developer`, t`AI providers`, t`API keys`, t`MCP`, t`Integrations`]}
					value="navigation.settings.ai"
					onSelect={() => onNavigate("/dashboard/settings/ai")}
				>
					<Icon name="key" size={16} />
					<Trans>AI & developer</Trans>
				</CommandItem>
			</BaseCommandGroup>
		</>
	);
}
