import { useSegments } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import * as StoreReview from "expo-store-review";
import { useEffect, useRef } from "react";
import { AppState, Keyboard, Platform } from "react-native";
import { getAccountScope, useSession } from "@/auth/session";

const delay = 5 * 60 * 1000;
const cooldown = 3 * 24 * 60 * 60 * 1000;
// Store reviews belong to this installation; switching accounts must not reset the cooldown.
const nextPromptKey = "reactive-resume:review-next-at";

/** Native prompts expose neither ratings nor dismissals. Persist attempts, never an assumed completed review. */
export function useReviewPrompt() {
	const session = useSession();
	const scope = session.status === "signed-in" ? getAccountScope() : null;
	const path = useSegments().join("/");
	const canPrompt = ["(tabs)/documents", "(tabs)/applications", "(tabs)/career", "(tabs)/settings"].includes(path);
	const progress = useRef({ scope: null as string | null, remaining: delay });

	useEffect(() => {
		if (progress.current.scope !== scope) progress.current = { scope, remaining: delay };
		if (!scope || (Platform.OS !== "ios" && Platform.OS !== "android")) return;

		const budget = progress.current;
		let startedAt: number | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let cancelled = false;
		const pause = () => {
			clearTimeout(timer);
			if (startedAt !== null) budget.remaining = Math.max(0, budget.remaining - (Date.now() - startedAt));
			startedAt = null;
		};
		const request = async () => {
			try {
				if (
					!(await StoreReview.isAvailableAsync()) ||
					cancelled ||
					AppState.currentState !== "active" ||
					Keyboard.isVisible() ||
					getAccountScope() !== scope
				)
					return;
				const next = Number(Storage.getItemSync(nextPromptKey));
				if (Number.isFinite(next) && next > Date.now()) return;
				// Write first: quota suppression, dismissal, errors, or process death must not cause repeated prompts.
				Storage.setItemSync(nextPromptKey, String(Date.now() + cooldown));
				await StoreReview.requestReview();
			} catch {
				// Optional feedback must never interrupt work when storage or the native store is unavailable.
			}
		};
		const resume = () => {
			pause();
			if (AppState.currentState !== "active") return;
			startedAt = Date.now();
			if (!canPrompt || Keyboard.isVisible()) return;
			try {
				const next = Number(Storage.getItemSync(nextPromptKey));
				const wait = Number.isFinite(next) ? Math.max(0, next - Date.now()) : 0;
				timer = setTimeout(
					() => {
						pause();
						void request();
					},
					Math.min(2_147_483_647, Math.max(budget.remaining, wait)),
				);
			} catch {
				// Without durable cooldown storage, skip the prompt.
			}
		};

		resume();
		const stateListener = AppState.addEventListener("change", resume);
		const keyboardListener = Keyboard.addListener("keyboardDidHide", resume);
		return () => {
			cancelled = true;
			pause();
			stateListener.remove();
			keyboardListener.remove();
		};
	}, [scope, canPrompt]);
}
