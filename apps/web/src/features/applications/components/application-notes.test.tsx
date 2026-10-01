// @vitest-environment happy-dom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApplicationNotes } from "./application-notes";

const mocks = vi.hoisted(() => ({ update: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/libs/orpc/client", () => ({
	orpc: {
		applications: {
			update: { mutationOptions: () => ({ mutationFn: mocks.update }) },
			getById: { queryKey: ({ input }: { input: { id: string } }) => ["application", input.id] },
		},
	},
}));
vi.mock("../use-application-actions", () => ({ useInvalidateApplications: () => mocks.invalidate }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: vi.fn() } }));

afterEach(() => vi.resetAllMocks());

function open(id: string, client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })) {
	i18n.load("en", {});
	i18n.activate("en");
	const notes = client.getQueryData<{ notes: string }>(["application", id])?.notes ?? "Saved";
	return render(
		<QueryClientProvider client={client}>
			<I18nProvider i18n={i18n}>
				<ApplicationNotes application={{ id, notes }} />
			</I18nProvider>
		</QueryClientProvider>,
	);
}

it("retains a failed note across closing and reopening, then retries it", async () => {
	mocks.update.mockRejectedValue(new Error("offline"));
	const view = open("failed-notes");
	fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "Keep this draft" } });
	await waitFor(() => expect(mocks.update).toHaveBeenCalled(), { timeout: 2000 });
	await act(async () => {
		view.unmount();
	});
	mocks.update.mockResolvedValue({});
	open("failed-notes");
	expect((screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement).value).toBe("Keep this draft");
	await waitFor(
		() =>
			expect(mocks.update).toHaveBeenLastCalledWith(
				{ id: "failed-notes", notes: "Keep this draft" },
				expect.anything(),
			),
		{ timeout: 2000 },
	);
});

it("keeps acknowledged notes in the cache when the sheet reopens before refetch", async () => {
	mocks.update.mockResolvedValue({});
	const client = new QueryClient();
	client.setQueryData(["application", "acknowledged-notes"], { notes: "Saved" });
	const view = open("acknowledged-notes", client);
	fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "Acknowledged draft" } });
	await waitFor(
		() =>
			expect(client.getQueryData(["application", "acknowledged-notes"])).toMatchObject({ notes: "Acknowledged draft" }),
		{ timeout: 2000 },
	);
	view.unmount();
	open("acknowledged-notes", client);
	expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("Acknowledged draft");
});

it("serializes note saves so a delayed response cannot overwrite newer text", async () => {
	let resolve: (value: unknown) => void = vi.fn();
	const first = new Promise<unknown>((accept) => {
		resolve = accept;
	});
	mocks.update.mockReturnValueOnce(first).mockResolvedValue({});
	const view = open("ordered-notes");
	fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "First" } });
	await waitFor(() => expect(mocks.update).toHaveBeenCalledTimes(1), { timeout: 2000 });
	fireEvent.change(screen.getByRole("textbox", { name: "Notes" }), { target: { value: "Second" } });
	await act(async () => {
		view.unmount();
	});
	expect(mocks.update).toHaveBeenCalledTimes(1);
	await act(async () => {
		resolve({});
	});
	await waitFor(() =>
		expect(mocks.update).toHaveBeenLastCalledWith({ id: "ordered-notes", notes: "Second" }, expect.anything()),
	);
});
