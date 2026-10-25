import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext, useRouter, useSearch } from "@tanstack/react-router";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
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
				await authClient.signOut();
				clearAccountData(queryClient);
				await navigate({ to: "/" });
				void router.invalidate();
			}}
		>
			<Icon name="sign-out" size={18} />
			<Trans>Sign out</Trans>
		</Button>
	);
}
