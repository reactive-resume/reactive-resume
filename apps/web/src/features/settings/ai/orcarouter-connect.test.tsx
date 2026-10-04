// @vitest-environment happy-dom

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

const mocks = vi.hoisted(() => ({
	begin: vi.fn(),
	complete: vi.fn(),
	cancel: vi.fn(),
	onConnected: vi.fn(),
}));

vi.mock("@/libs/orpc/client", () => ({
	client: {
		aiProviders: {
			orcaConnectBegin: mocks.begin,
			orcaConnectComplete: mocks.complete,
			orcaConnectCancel: mocks.cancel,
		},
	},
	orpc: {
		aiProviders: {
			list: {
				key: () => ["aiProviders", "list"],
				queryOptions: () => ({ queryKey: ["aiProviders", "list"], queryFn: async () => [] }),
			},
		},
	},
}));

i18n.loadAndActivate({ locale: "en", messages: {} });

const { useOrcaConnect } = await import("./orcarouter-connect");

type Handle = ReturnType<typeof useOrcaConnect>;

function Harness({ onRef }: { onRef: (handle: Handle) => void }) {
	const connect = useOrcaConnect({ onConnected: mocks.onConnected });
	onRef(connect);
	return (
		<div>
			<span data-testid="phase">{connect.state.phase}</span>
			{"authorizeUrl" in connect.state && <span data-testid="url">{connect.state.authorizeUrl}</span>}
		</div>
	);
}

function renderHarness() {
	let handle: Handle | undefined;
	const view = render(
		<I18nProvider i18n={i18n}>
			<Harness onRef={(value) => (handle = value)} />
		</I18nProvider>,
	);
	if (!handle) throw new Error("Hook handle missing");
	return { handle: handle as Handle, unmount: view.unmount };
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.begin.mockResolvedValue({
		connectId: "connect-1",
		authorizeUrl: "https://www.orcarouter.ai/auth?state=abc",
		expiresInSeconds: 600,
	});
	mocks.cancel.mockResolvedValue({ status: "cancelled" });
	mocks.complete.mockResolvedValue({ id: "provider-1", method: "pkce", scope: "api" });
});

describe("OrcaRouter browser connect lifecycle", () => {
	it("reaches the waiting phase and clears the busy state on pagehide without remounting", async () => {
		const { handle: connect } = renderHarness();

		await act(async () => {
			await connect.start();
		});
		await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("waiting"));

		act(() => {
			window.dispatchEvent(new Event("pagehide"));
		});

		// The back-forward-cache restore must not be left permanently busy: busy/hint clear synchronously.
		expect(screen.getByTestId("phase").textContent).toBe("idle");
		await waitFor(() =>
			expect(mocks.cancel).toHaveBeenCalledWith({ connectId: "connect-1" }, { context: { keepalive: true } }),
		);

		// A second login starts on the same mounted component.
		mocks.begin.mockResolvedValue({
			connectId: "connect-2",
			authorizeUrl: "https://www.orcarouter.ai/auth?state=def",
			expiresInSeconds: 600,
		});
		await act(async () => {
			await connect.start();
		});
		await waitFor(() => expect(screen.getByTestId("phase").textContent).toBe("waiting"));
		expect(mocks.begin).toHaveBeenCalledTimes(2);
	});

	it("ignores a stale begin response that arrives after a newer attempt started", async () => {
		const { handle: connect } = renderHarness();

		let releaseFirst: (value: { connectId: string; authorizeUrl: string; expiresInSeconds: number }) => void = () => {};
		mocks.begin
			.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						releaseFirst = resolve;
					}),
			)
			.mockResolvedValueOnce({
				connectId: "connect-2",
				authorizeUrl: "https://www.orcarouter.ai/auth?state=second",
				expiresInSeconds: 600,
			});

		let first: Promise<unknown> | undefined;
		await act(async () => {
			first = connect.start();
		});
		// The user restarts before the first response lands.
		await act(async () => {
			connect.cancel();
		});
		await act(async () => {
			await connect.start();
		});
		await waitFor(() => expect(screen.getByTestId("url").textContent).toContain("second"));

		await act(async () => {
			releaseFirst({
				connectId: "connect-1",
				authorizeUrl: "https://www.orcarouter.ai/auth?state=first",
				expiresInSeconds: 600,
			});
			await first;
		});

		// The late response must not become the visible URL, and its server-side attempt is released.
		expect(screen.getByTestId("url").textContent).toContain("second");
		expect(mocks.cancel).toHaveBeenCalledWith({ connectId: "connect-1" });
	});

	it("releases the attempt on explicit cancel and on unmount", async () => {
		const { handle: connect, unmount } = renderHarness();
		await act(async () => {
			await connect.start();
		});
		act(() => connect.cancel());
		expect(screen.getByTestId("phase").textContent).toBe("idle");
		expect(mocks.cancel).toHaveBeenCalledWith({ connectId: "connect-1" });

		await act(async () => {
			await connect.start();
		});
		// Unmounting releases the server-side attempt without writing React state.
		mocks.cancel.mockClear();
		unmount();
		expect(mocks.cancel).toHaveBeenCalledWith({ connectId: "connect-1" });
	});

	it("surfaces a start failure and stays idle", async () => {
		const { handle: connect } = renderHarness();
		mocks.begin.mockRejectedValueOnce(new Error("boom"));

		await act(async () => {
			await connect.start();
		});

		expect(screen.getByTestId("phase").textContent).toBe("error");
		act(() => connect.reset());
		expect(screen.getByTestId("phase").textContent).toBe("idle");
	});

	it("surfaces an exchange failure, releases the busy state, and lets another attempt start", async () => {
		const { handle: connect } = renderHarness();
		await act(async () => {
			await connect.start();
		});
		mocks.complete.mockRejectedValueOnce(new Error("That code is unknown, already used, or expired."));

		await act(async () => {
			await connect.complete("code-1");
		});

		expect(screen.getByTestId("phase").textContent).toBe("error");
		await act(async () => {
			await connect.start();
		});
		expect(mocks.begin).toHaveBeenCalledTimes(2);
	});

	it("reports success with the granted scope and never exposes the verifier", async () => {
		const { handle: connect } = renderHarness();
		await act(async () => {
			await connect.start();
		});
		await act(async () => {
			await connect.complete("code-1");
		});

		expect(screen.getByTestId("phase").textContent).toBe("done");
		expect(mocks.onConnected).toHaveBeenCalledTimes(1);
		expect(mocks.complete).toHaveBeenCalledWith({ connectId: "connect-1", code: "code-1" });
		expect(JSON.stringify(mocks.complete.mock.calls)).not.toContain("code_verifier");
	});
});
