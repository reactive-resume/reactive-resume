import type { PreparedRequest } from "@reactive-resume/utils/deferred-request";
import { t } from "@lingui/core/macro";
import { AppState } from "react-native";
import { getAccountScope } from "@/auth/session";
import { dismissToast, showToast, toastLifetime } from "@/ui";

type UndoNotice = { message: string; restore: () => unknown; failed: () => void };
type UndoOptions<T> = UndoNotice &
	(
		| { commit: () => Promise<unknown> }
		| { prepare: () => Promise<PreparedRequest<T>>; commit: (result: Promise<T>) => unknown }
	);

/** Prepared requests reach the transport in the background event's stack, before JS can suspend. */
export function withUndo<T>(options: UndoOptions<T>) {
	if (!("prepare" in options)) return showUndo(options);
	const scope = getAccountScope();
	const current = () => scope === getAccountScope();
	let operation: ReturnType<typeof showUndo> | undefined;
	let intent: "flush" | "cancel" | undefined;
	const restore = async (report: boolean) => {
		if (!current()) return;
		try {
			await options.restore();
		} catch {
			if (report && current()) options.failed();
		}
	};
	const failed = () => {
		if (!current()) return;
		void restore(false);
		options.failed();
	};
	const prepared = (request: PreparedRequest<T>) => {
		if (!current() || intent === "cancel") {
			request.cancel();
			if (intent === "cancel") void restore(true);
			return;
		}
		operation = showUndo({
			message: options.message,
			commit: () => {
				if (!current()) {
					request.cancel();
					return Promise.resolve();
				}
				return Promise.resolve(options.commit(request.send()));
			},
			restore: () => {
				request.cancel();
				if (current()) return options.restore();
			},
			failed: () => {
				if (current()) options.failed();
			},
		});
		if (intent === "flush" || AppState.currentState === "background") operation.flush();
	};
	try {
		void options.prepare().then(prepared, () => {
			if (intent !== "cancel") failed();
		});
	} catch {
		failed();
	}
	return {
		flush: () => {
			if (intent === "cancel") return;
			intent = "flush";
			operation?.flush();
		},
		cancel: () => {
			if (intent === "flush") return;
			intent = "cancel";
			operation?.cancel();
		},
	};
}

/** Own timer because the native toast has no close callback. Local callbacks keep their existing Undo window. */
function showUndo({ message, commit, restore, failed }: UndoNotice & { commit: () => Promise<unknown> }) {
	let settled = false;
	const reconcile = (report: boolean) => {
		try {
			void Promise.resolve(restore()).catch(() => {
				if (report) failed();
			});
		} catch {
			if (report) failed();
		}
	};
	const finish = (apply: boolean) => {
		if (settled) return;
		settled = true;
		clearTimeout(timer);
		listener.remove();
		dismissToast(toast);
		if (apply) {
			const rejected = () => {
				reconcile(false);
				failed();
			};
			try {
				void commit().catch(rejected);
			} catch {
				rejected();
			}
		} else reconcile(true);
	};
	const timer = setTimeout(() => finish(true), toastLifetime(6000));
	const listener = AppState.addEventListener("change", (state) => {
		if (state === "background") finish(true);
	});
	const toast = showToast({ message, duration: 6000, action: { label: t`Undo`, onPress: () => finish(false) } });
	return { flush: () => finish(true), cancel: () => finish(false) };
}
