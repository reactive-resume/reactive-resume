import * as Network from "expo-network";
import { AppState } from "react-native";
import { letter, resume } from "./draft/runtime";
import { writeQueue } from "./queue";
import { realBackend, type Backend } from "./resources";
import { getAccountScope } from "@/auth/session";

export async function syncQueued(scope = getAccountScope(), backend: Backend = realBackend) {
	if (!scope) throw Object.assign(new Error("Sign in again."), { code: "SESSION_EXPIRED" });
	const network = await Network.getNetworkStateAsync();
	if (network.isConnected === false || network.isInternetReachable === false)
		throw Object.assign(new Error("Changes are kept on this device."), { code: "OFFLINE" });
	await Promise.all([resume.store.getState().flush(), letter.store.getState().flush()]);
	await Promise.all([resume.replay(), letter.replay()]);
	await writeQueue.flush(
		scope,
		(row) => backend.write(row.operation, row.input, scope),
		() => backend.kind === "fake" || getAccountScope() === scope,
	);
}
export function watchQueue(scope: string, backend: Backend, onSynced: () => void) {
	let active = true;
	const sync = () => {
		if (active)
			void syncQueued(scope, backend)
				.then(() => {
					if (active) onSynced();
				})
				.catch(() => {});
	};
	const network = Network.addNetworkStateListener((state) => {
		if (state.isConnected !== false && state.isInternetReachable !== false) sync();
	});
	const app = AppState.addEventListener("change", (state) => {
		if (state === "active") sync();
	});
	sync();
	return () => {
		active = false;
		network.remove();
		app.remove();
	};
}
