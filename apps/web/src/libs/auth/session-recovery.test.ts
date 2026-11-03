// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("./client", () => ({ authClient: { getSession: mocks.getSession } }));
import { invalidateAccountScope, setAccountScope } from "./account-scope";
import { reportSessionLoss, sessionSignInURL, useSessionRecovery } from "./session-recovery";

beforeEach(() => {
	invalidateAccountScope();
	setAccountScope("alice");
	useSessionRecovery.setState({ accountId: null });
	mocks.getSession.mockReset();
});

it("deduplicates concurrent expired-session checks without changing the account scope", async () => {
	let finish!: (value: unknown) => void;
	mocks.getSession.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	const first = reportSessionLoss("alice");
	const second = reportSessionLoss("alice");
	expect(mocks.getSession).toHaveBeenCalledTimes(1);
	finish({ data: null, error: null });
	await Promise.all([first, second]);
	expect(useSessionRecovery.getState().accountId).toBe("alice");
});

it.each([
	{ data: { user: { id: "alice" } }, error: null },
	{ data: null, error: { status: 500 } },
	{ data: null, error: { status: 429 } },
])("does not call transient errors or a healthy session expired: %j", async (result) => {
	mocks.getSession.mockResolvedValue(result);
	await reportSessionLoss("alice");
	expect(useSessionRecovery.getState().accountId).toBeNull();
});

it("ignores old-account replies and a check overtaken by a same-account new generation", async () => {
	let finish!: (value: unknown) => void;
	mocks.getSession.mockReturnValue(
		new Promise((resolve) => {
			finish = resolve;
		}),
	);
	expect(reportSessionLoss("bob")).toBeUndefined();
	const checking = reportSessionLoss("alice");
	invalidateAccountScope();
	setAccountScope("alice");
	finish({ data: null, error: null });
	await checking;
	expect(useSessionRecovery.getState().accountId).toBeNull();
});

it("preserves path, query and hash as an encoded callback for a new-tab reauthentication", () => {
	window.history.replaceState(null, "", "/builder/example?mode=write#summary");
	const url = new URL(sessionSignInURL(), window.location.origin);
	expect(url.pathname).toBe("/auth/login");
	expect(url.searchParams.get("callbackURL")).toBe("/builder/example?mode=write#summary");
	expect(url.searchParams.get("reauthenticate")).toBe("true");
});
