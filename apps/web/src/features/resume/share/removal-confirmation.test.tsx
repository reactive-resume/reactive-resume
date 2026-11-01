import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
// @vitest-environment happy-dom
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { CustomDomainField } from "./custom-domain-field";
import { WebAccessSection } from "@/features/settings/ai/web-access";
import { ConfirmDialogProvider } from "@/hooks/use-confirm";

const state = vi.hoisted(() => ({ remove: vi.fn(), failure: false }));
vi.mock("@/libs/orpc/client", () => {
	const endpoint = (name: string) => ({
		queryOptions: () => ({ name }),
		mutationOptions: () => ({ name }),
		queryKey: () => [name],
		key: () => [name],
	});
	return {
		orpc: {
			customDomain: Object.fromEntries(
				["get", "suggestion", "set", "verify", "remove"].map((name) => [name, endpoint(name)]),
			),
			webAccess: Object.fromEntries(["status", "save", "delete", "test"].map((name) => [name, endpoint(name)])),
		},
	};
});
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
	useQuery: ({ name }: { name: string }) => ({
		data:
			name === "get"
				? { hostname: "resume.example.test", verified: true, records: [], target: "domains.example.test" }
				: name === "status"
					? {
							configured: true,
							managed: false,
							canSave: true,
							provider: "firecrawl",
						}
					: undefined,
		isPending: false,
	}),
	useMutation: ({ name }: { name: string }) => ({
		mutate: (...args: unknown[]) => state.remove(name, ...args),
		isPending: false,
		error: name === "delete" && state.failure ? new Error("Synthetic removal failed") : null,
	}),
}));
vi.mock("@/features/settings/integrations/hooks/use-has-usable-ai-provider", () => ({
	useHasUsableAiProvider: () => ({ hasUsableProvider: true }),
}));

beforeEach(() => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	state.remove.mockClear();
	state.failure = false;
});
afterEach(cleanup);

describe.each([
	{
		name: "custom domain",
		component: <CustomDomainField suggest={false} />,
		trigger: "Remove",
		title: "Remove the custom domain?",
		keep: "Keep domain",
		confirm: "Remove domain",
		endpoint: "remove",
	},
	{
		name: "web connection",
		component: <WebAccessSection />,
		trigger: "Remove connection",
		title: "Remove the web connection?",
		keep: "Keep connection",
		confirm: "Remove connection",
		endpoint: "delete",
	},
])("$name removal", ({ component, trigger, title, keep, confirm, endpoint }) => {
	it("keeps saved connection until explicit confirmation; cancellation sends no mutation", async () => {
		render(
			<I18nProvider i18n={i18n}>
				<ConfirmDialogProvider>{component}</ConfirmDialogProvider>
			</I18nProvider>,
		);
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: trigger }));
		});
		expect(state.remove).not.toHaveBeenCalled();
		expect(screen.getByRole("alertdialog", { name: title })).toBeTruthy();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: keep }));
		});
		expect(state.remove).not.toHaveBeenCalled();
		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: trigger }));
		});
		const dialog = screen.getByRole("alertdialog", { name: title });
		const button = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === confirm);
		if (!button) throw new Error("Missing removal confirmation button");
		await act(async () => {
			fireEvent.click(button);
		});
		expect(state.remove).toHaveBeenCalledTimes(1);
		expect(state.remove.mock.calls[0]?.[0]).toBe(endpoint);
	});
});
