import type { DraftEnvironment } from "./store";
import type { NetworkState } from "expo-network";
import * as Network from "expo-network";
import { AppState, Keyboard, TextInput } from "react-native";
import { getRetainedAccountScope } from "@/auth/session";
import Storage from "@/data/storage";

let online = true;

/**
 * Partition local documents by OAuth subject as well as server; signing in as another user never replays them. Read
 * from the stored session without a refresh, so drafts open offline.
 */
const scope = () => Promise.resolve(getRetainedAccountScope());

export const nativeEnvironment: DraftEnvironment = {
	storage: Storage,
	scope,
	online: () => online,
	focused: () => TextInput.State.currentlyFocusedInput() !== null || Keyboard.isVisible(),
};

type SyncTarget = {
	flush: () => Promise<void>;
	refresh: () => Promise<void>;
	replay: () => Promise<void>;
	blur: () => Promise<void>;
};

/** Started on first open. The queue outlives the editor; suspending the session removes its listeners. */
export function watchDraft(target: SyncTarget) {
	let active = true;
	let lastOnline = online;
	const reconnect = (state: NetworkState) => {
		if (!active) return;
		const wasOnline = lastOnline;
		online = state.isConnected !== false && state.isInternetReachable !== false;
		lastOnline = online;
		if (!online) void target.flush();
		if (!wasOnline && online)
			void target
				.replay()
				.then(target.refresh)
				.catch(() => {});
	};
	const network = Network.addNetworkStateListener(reconnect);
	void Network.getNetworkStateAsync()
		.then(reconnect)
		.catch(() => {});
	const app = AppState.addEventListener("change", (state) => {
		if (state !== "active") void target.flush();
		else
			void target
				.replay()
				.then(target.refresh)
				.catch(() => {});
	});
	const keyboard = Keyboard.addListener("keyboardDidHide", () => void target.blur());
	return () => {
		active = false;
		network.remove();
		app.remove();
		keyboard.remove();
	};
}
