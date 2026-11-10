import { useNetworkState } from "expo-network";
import { useDataBackend } from "./provider";
export function connectivityState(state: { isConnected?: boolean; isInternetReachable?: boolean }) {
	return state.isConnected === false || state.isInternetReachable === false
		? "offline"
		: state.isConnected === true && state.isInternetReachable === true
			? "online"
			: "unknown";
}
export function useConnectivity() {
	const network = useNetworkState();
	const { backend } = useDataBackend();
	const status = backend.kind === "fake" ? "online" : connectivityState(network);
	return { ...network, status, offline: status === "offline", online: status === "online" };
}
