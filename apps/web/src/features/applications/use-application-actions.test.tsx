// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ update: vi.fn(), toast: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			update: { mutationOptions: () => ({ mutationFn: mocks.update }) },
			delete: { mutationOptions: () => ({ mutationFn: vi.fn() }) },
			stats: { queryKey: () => ["stats"] },
			tags: { queryKey: () => ["tags"] },
			getById: { queryKey: () => ["application"] },
		},
		documents: { list: { key: () => ["documents"] } },
	},
}));
vi.mock("./queries", () => ({ applicationsListQueryKey: () => ["applications"] }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));

import { useApplicationActions } from "./use-application-actions";

it.each([
	[
		"moves",
		(actions: ReturnType<typeof useApplicationActions>) => actions.moveTo({ id: "a" }, "applied"),
		"Moved to Applied",
	],
	[
		"closes",
		(actions: ReturnType<typeof useApplicationActions>) => actions.close({ id: "a" }, "withdrew"),
		"Application closed",
	],
])("confirms when it %s even after the caller unmounts", async (_name, act, message) => {
	i18n.load("en", {});
	i18n.activate("en");
	mocks.toast.mockClear();
	let resolve = () => {};
	mocks.update.mockReturnValue(new Promise<void>((done) => (resolve = done)));
	const client = new QueryClient();
	const wrapper = ({ children }: { children: ReactNode }) => (
		<QueryClientProvider client={client}>{children}</QueryClientProvider>
	);
	// A board card's ⋯ menu unmounts as soon as the optimistic move puts the card in another column.
	const { result, unmount } = renderHook(() => useApplicationActions(), { wrapper });
	act(result.current);
	unmount();
	resolve();

	await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({ description: message }));
});
