import { useQuery } from "@tanstack/react-query";
import { orpc } from "./client";
import { useSession } from "@/auth/session";

/** The server's feature flags, keyed by server so one server's flags (its alias URL) never carry over to another. */
export function useFlags() {
	const { server } = useSession();
	return useQuery({ ...orpc.flags.get.queryOptions(), queryKey: [...orpc.flags.get.key(), server] });
}
