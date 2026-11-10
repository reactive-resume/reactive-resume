import { isFake, invokeFake } from "./fixtures";
import { invokeGuest } from "./guest";
import { client } from "@/api/client";
import { getSession } from "@/auth/session";
/** Draft adapters and lifecycle actions share the provider's production/fake switch. Never send fixture IDs. */
function proxy(path: string[]): unknown {
	return new Proxy(() => {}, {
		get: (_target, name: string) => (name === "then" ? undefined : proxy([...path, name])),
		apply: (_target, _this, args: unknown[]) => {
			if (isFake()) return invokeFake(path.join("."), args[0]);
			if (getSession().status === "guest") return invokeGuest(path.join("."), args[0]);
			let procedure: unknown = client;
			for (const segment of path) procedure = (procedure as Record<string, unknown>)[segment];
			return (procedure as (...input: unknown[]) => unknown)(...args);
		},
	});
}
export const dataClient = proxy([]) as typeof client;
