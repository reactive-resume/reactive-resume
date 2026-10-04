import type { RouterOutput } from "@/libs/orpc/client";
import { t } from "@lingui/core/macro";
import { useEffect, useRef, useState } from "react";
import { getOrpcErrorMessage } from "@/libs/error-message";
import { client, orpc } from "@/libs/orpc/client";

type BeginResult = RouterOutput["aiProviders"]["orcaConnectBegin"];

export type OrcaConnectState =
	| { phase: "idle" }
	| { phase: "starting" }
	| { phase: "waiting"; connectId: string; authorizeUrl: string }
	| { phase: "exchanging"; connectId: string; authorizeUrl: string }
	| { phase: "done"; providerId: string; scope: string | null }
	| { phase: "error"; message: string };

/**
 * Drives one OrcaRouter connect attempt from the browser.
 *
 * Every asynchronous response is checked against a monotonically increasing attempt id, so a late
 * response from an earlier attempt cannot overwrite a newer login. The idle state is always
 * reachable — cancel, denial, exchange error, timeout, closing the dialog, unmounting, and
 * `pagehide` all release it — and `pagehide` clears the busy state synchronously rather than relying
 * on a guarded `finally` that correctly refuses to run after the generation moved on.
 */
export function useOrcaConnect(options: {
	providerId?: string | null;
	label?: string | null;
	onConnected?: () => void;
}) {
	const [state, setState] = useState<OrcaConnectState>({ phase: "idle" });
	const attemptRef = useRef(0);
	const connectIdRef = useRef<string | null>(null);
	// Mirror of the phase for handlers that must read it without being re-created: `pagehide` reads the
	// authoritative value synchronously.
	const stateRef = useRef<OrcaConnectState>(state);
	stateRef.current = state;

	const beginAttempt = () => {
		const attempt = attemptRef.current + 1;
		attemptRef.current = attempt;
		connectIdRef.current = null;
		return attempt;
	};

	const isCurrent = (attempt: number) => attemptRef.current === attempt;

	/** Idempotent: safe to call for success, denial, cancel, timeout or unmount. */
	const release = (connectId: string | null) => {
		if (!connectId) return;
		void client.aiProviders.orcaConnectCancel({ connectId }).catch(() => {
			// A released or expired attempt is already gone; nothing to report to the user.
		});
	};

	const finish = () => {
		setState({ phase: "idle" });
	};

	const start = async () => {
		const attempt = beginAttempt();
		setState({ phase: "starting" });
		let begun: BeginResult;
		try {
			begun = await client.aiProviders.orcaConnectBegin({
				...(options.providerId ? { providerId: options.providerId } : {}),
				...(options.label ? { label: options.label } : {}),
			});
		} catch (error) {
			if (!isCurrent(attempt)) return null;
			setState({
				phase: "error",
				message: getOrpcErrorMessage(error, { fallback: t`Couldn't start the OrcaRouter sign-in.` }),
			});
			return null;
		}
		if (!isCurrent(attempt)) {
			// A newer attempt already started; this response must not become the visible one.
			release(begun.connectId);
			return null;
		}
		connectIdRef.current = begun.connectId;
		setState({ phase: "waiting", connectId: begun.connectId, authorizeUrl: begun.authorizeUrl });
		return begun;
	};

	const complete = async (code: string) => {
		const current = stateRef.current;
		if (current.phase !== "waiting" && current.phase !== "exchanging") {
			throw new Error("No OrcaRouter sign-in is in progress.");
		}
		const { connectId, authorizeUrl } = current;
		const attempt = attemptRef.current;
		setState({ phase: "exchanging", connectId, authorizeUrl });
		try {
			const result = await client.aiProviders.orcaConnectComplete({ connectId, code });
			if (!isCurrent(attempt)) return null;
			connectIdRef.current = null;
			setState({ phase: "done", providerId: result.id, scope: result.scope });
			options.onConnected?.();
			return result;
		} catch (error) {
			if (!isCurrent(attempt)) return null;
			// The attempt is consumed on the server for terminal failures; either way it is no longer usable.
			connectIdRef.current = null;
			setState({
				phase: "error",
				message: getOrpcErrorMessage(error, { fallback: t`Couldn't finish the OrcaRouter sign-in.` }),
			});
			return null;
		}
	};

	const cancel = () => {
		const connectId = connectIdRef.current;
		beginAttempt();
		connectIdRef.current = null;
		setState({ phase: "idle" });
		release(connectId);
	};

	const reset = () => {
		beginAttempt();
		connectIdRef.current = null;
		setState({ phase: "idle" });
	};

	// Back-forward-cache and window close: invalidate the generation, clear the busy flag and hint
	// synchronously, then ask the server to release the attempt with `keepalive`. The guarded
	// `finally` of an in-flight request would refuse to touch state here, which is exactly why this
	// handler cannot delegate the cleanup to it.
	useEffect(() => {
		const onPageHide = () => {
			const connectId = connectIdRef.current;
			beginAttempt();
			connectIdRef.current = null;
			setState({ phase: "idle" });
			if (!connectId) return;
			void client.aiProviders.orcaConnectCancel({ connectId }, { context: { keepalive: true } }).catch(() => undefined);
		};
		window.addEventListener("pagehide", onPageHide);
		return () => {
			window.removeEventListener("pagehide", onPageHide);
			// Unmounting releases the server-side attempt without writing React state.
			const connectId = connectIdRef.current;
			attemptRef.current += 1;
			connectIdRef.current = null;
			if (connectId) void client.aiProviders.orcaConnectCancel({ connectId }).catch(() => undefined);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps -- registered once; the refs above carry the live values.
	}, []);

	return { state, start, complete, cancel, reset, finish };
}

export const orcaConnectQueryKey = orpc.aiProviders.list.key();
