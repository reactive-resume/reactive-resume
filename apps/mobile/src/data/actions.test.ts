let mockScope = "account";
const mockQueuedWrite = jest.fn();
const mockWrite = jest.fn(async (..._args: unknown[]) => undefined);
const mockInvalidate = jest.fn(async (..._args: unknown[]) => undefined);
jest.mock("./provider", () => ({
	useDataBackend: () => ({
		backend: { kind: "real", write: (...args: unknown[]) => mockWrite(...args) },
		scope: "account",
	}),
	useDataActions: () => ({ write: (...args: unknown[]) => mockQueuedWrite(...args), flush: jest.fn() }),
}));
jest.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: (...args: unknown[]) => mockInvalidate(...args) }),
}));
jest.mock("@/auth/session", () => ({ getAccountScope: () => mockScope }));
jest.mock("@reactive-resume/utils/string", () => ({ generateId: () => "id" }));
import { usePlatformActions, useDocumentActions } from "./actions";
beforeEach(() => {
	mockScope = "account";
	mockWrite.mockReset();
	mockInvalidate.mockClear();
});
test("online actions forward Stop signal and invalidate only their initiating account", async () => {
	const signal = new AbortController().signal;
	const input = { type: "resume" as const, id: "r", name: "Renamed" };
	await usePlatformActions().run("documents.rename", input, signal);
	expect(mockWrite).toHaveBeenCalledWith("documents.rename", input, "account", signal);
	expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ["account"] });
});
test("an already stopped action cannot reach the backend", async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		usePlatformActions().run("documents.rename", { type: "resume", id: "r", name: "Renamed" }, controller.signal),
	).rejects.toThrow();
	expect(mockWrite).not.toHaveBeenCalled();
});
test("a response after account switch cannot invalidate or return through the new account", async () => {
	mockWrite.mockImplementationOnce(async () => {
		mockScope = "other";
	});
	await expect(
		usePlatformActions().run("documents.rename", { type: "resume", id: "r", name: "Renamed" }),
	).rejects.toThrow("account changed");
	expect(mockInvalidate).not.toHaveBeenCalled();
});

test("letter metadata writes stay in the letter group for S8 pending counts", () => {
	useDocumentActions().setTags({ type: "letter", id: "letter", tags: ["Design"] });
	expect(mockQueuedWrite).toHaveBeenCalledWith("letters", "documents.setTags", {
		type: "letter",
		id: "letter",
		tags: ["Design"],
	});
});
