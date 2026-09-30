import { Trans } from "@lingui/react/macro";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouteContext, useRouter } from "@tanstack/react-router";
import { Button } from "@reactive-resume/ui/components/button";
import { Icon } from "@reactive-resume/ui/components/icon";
import { DataSection } from "./data";
import { ProfileSection } from "./profile";
import { SecuritySection } from "./security";
import { authClient } from "@/libs/auth/client";

export function AccountSettings() {
	const { session } = useRouteContext({ from: "/dashboard" });

	return (
		<>
			<ProfileSection session={session} />
			<SecuritySection />
			<DataSection />
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
				queryClient.clear();
				await navigate({ to: "/" });
				void router.invalidate();
			}}
		>
			<Icon name="logout" size={18} />
			<Trans>Sign out</Trans>
		</Button>
	);
}
