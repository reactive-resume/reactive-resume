// @vitest-environment happy-dom

import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type SignOutOptions = { fetchOptions: { onSuccess: () => void } };

const router = vi.hoisted(() => ({ invalidate: vi.fn(), navigate: vi.fn(async () => {}) }));
const signOut = vi.hoisted(() =>
	vi.fn(({ fetchOptions }: SignOutOptions) => {
		fetchOptions.onSuccess();
	}),
);

vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));
vi.mock("@/libs/auth/client", () => ({
	authClient: { signOut, useSession: () => ({ data: { user: { id: "user-1" } } }) },
}));
vi.mock("@/features/theme/provider", () => ({ useTheme: () => ({ theme: "light", setTheme: vi.fn() }) }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn(), close: vi.fn() } }));
vi.mock("@reactive-resume/ui/components/dropdown-menu", () => {
	const Passthrough = ({ children }: { children?: ReactNode }) => <>{children}</>;
	return {
		DropdownMenu: Passthrough,
		DropdownMenuContent: Passthrough,
		DropdownMenuGroup: Passthrough,
		DropdownMenuRadioGroup: Passthrough,
		DropdownMenuRadioItem: Passthrough,
		DropdownMenuSeparator: () => null,
		DropdownMenuSub: Passthrough,
		DropdownMenuSubContent: Passthrough,
		DropdownMenuSubTrigger: Passthrough,
		DropdownMenuTrigger: () => null,
		DropdownMenuItem: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
			<button type="button" onClick={onClick}>
				{children}
			</button>
		),
	};
});

i18n.loadAndActivate({ locale: "en", messages: {} });

const { UserDropdownMenu } = await import("./dropdown-menu");

describe("UserDropdownMenu", () => {
	it("clears the previous user's cached queries when signing out", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["resumes"], [{ id: "resume-1" }]);

		render(
			<I18nProvider i18n={i18n}>
				<QueryClientProvider client={queryClient}>
					<UserDropdownMenu>{() => <button type="button" />}</UserDropdownMenu>
				</QueryClientProvider>
			</I18nProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

		await waitFor(() => expect(router.invalidate).toHaveBeenCalled());
		expect(router.navigate).toHaveBeenCalledWith({ to: "/", replace: true });
		expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
	});
});
