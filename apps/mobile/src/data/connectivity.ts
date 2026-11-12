import { useNetworkState } from "expo-network";
export function connectivityState(state: { isConnected?: boolean; isInternetReachable?: boolean }) {
	return state.isConnected === false || state.isInternetReachable === false
		? "offline"
		: state.isConnected === true && state.isInternetReachable === true
			? "online"
			: "unknown";
}
export function useConnectivity() {
	const network = useNetworkState();
	const status = connectivityState(network);
	return { ...network, status, offline: status === "offline", online: status === "online" };
}
