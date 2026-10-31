import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext, useRouter, useSearch } from "@tanstack/react-router";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { toast } from "@reactive-resume/ui/components/toast";
import { ApplicationProfileSection } from "./application-profile";
import { DataSection } from "./data";
import { ProfileSection } from "./profile";
import { SecuritySection } from "./security";
import { PageHeader } from "@/components/layout/page-header";
import { clearAccountData } from "@/libs/auth/clear-account-data";
import { authClient } from "@/libs/auth/client";

export function AccountSettings() {
	const { session } = useRouteContext({ from: "/dashboard" });
	const { deleteAccount } = useSearch({ from: "/dashboard/settings/account" });

	return (
		<>
			<PageHeader title={<Trans>Account</Trans>} />
			<ProfileSection session={session} />
			<SecuritySection />
			<ApplicationProfileSection key={session.user.id} />
			<DataSection openDeletion={deleteAccount ?? false} />
			<div className="border-t border-line pt-6">
				<SignOutButton />
			</div>
		</>
	);
}

export function SignOutButton() {
	const router = useRouter();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	return (
		<Button
			variant="secondary"
			onClick={async () => {
				try {
					const result = await authClient.signOut();
					if (result.error) throw result.error;
					clearAccountData(queryClient);
					await navigate({ to: "/" });
					void router.invalidate();
				} catch {
					toast.add({ type: "error", description: t`Couldn't sign out. Try again.` });
				}
			}}
		>
			<Icon name="sign-out" size={18} />
			<Trans>Sign out</Trans>
		</Button>
	);
}
