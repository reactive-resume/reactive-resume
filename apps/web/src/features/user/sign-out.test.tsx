// @vitest-environment happy-dom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type SignOutOptions = { fetchOptions: { onSuccess: () => void } };

const router = vi.hoisted(() => ({ invalidate: vi.fn(), navigate: vi.fn(async () => {}) }));
const signOut = vi.hoisted(() =>
	vi.fn(({ fetchOptions }: SignOutOptions) => {
		fetchOptions.onSuccess();
	}),
);

vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));
vi.mock("@/libs/auth/client", () => ({ authClient: { signOut } }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { useSignOut } = await import("./sign-out");

function SignOut() {
	const signOut = useSignOut();
	return (
		<button type="button" onClick={() => void signOut()}>
			Sign out
		</button>
	);
}

it("clears the previous user's cached queries when signing out", async () => {
	const queryClient = new QueryClient();
	queryClient.setQueryData(["resumes"], [{ id: "resume-1" }]);

	render(
		<QueryClientProvider client={queryClient}>
			<SignOut />
		</QueryClientProvider>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

	await waitFor(() => expect(router.invalidate).toHaveBeenCalled());
	expect(router.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
	expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
});
