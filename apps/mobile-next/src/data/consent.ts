import { AI_PROVIDER_DEFAULT_BASE_URLS, type AIProvider } from "@reactive-resume/ai/types";
import { getAccountScope } from "@/auth/session";
import Storage from "@/data/storage";

export type DataKind = "file" | "audio" | "resume-and-facts" | "posting" | "chat";
export type Connection = { id: string; provider: string; host: string; keyFingerprint: string };
export type ConsentRequest = { kind: DataKind; connection: Connection; scope: string; disclosure?: string };
export type ConsentDecision = boolean | { approved: boolean; remember: boolean };
export type ConsentPresenter = (request: ConsentRequest) => Promise<ConsentDecision>;
let presenter: ConsentPresenter | undefined;
export function setConsentPresenter(next?: ConsentPresenter) {
	presenter = next;
}
export const connectionKey = (connection: Connection) =>
	JSON.stringify([connection.provider, connection.host, connection.keyFingerprint]);
export function providerConnection(provider: {
	id: string;
	provider: AIProvider;
	baseURL: string | null;
	apiKeyFingerprint: string;
}): Connection {
	return {
		id: provider.id,
		provider: provider.provider,
		host: new URL(provider.baseURL || AI_PROVIDER_DEFAULT_BASE_URLS[provider.provider]).origin,
		keyFingerprint: provider.apiKeyFingerprint,
	};
}
const storageKey = (scope: string) => `s7:${scope}`;
type Approvals = Record<string, { connection: string; kinds: DataKind[] }>;
function read(scope: string): Approvals {
	return JSON.parse(Storage.getItemSync(storageKey(scope)) ?? "{}");
}
export function listApprovals(scope = getAccountScope()) {
	return scope ? read(scope) : {};
}
export function resetApprovals(scope = getAccountScope()) {
	if (scope) Storage.removeItemSync(storageKey(scope));
}
const pending = new Map<string, Promise<boolean>>();
/** The opaque server recipientVersion fingerprints the saved key; raw keys never enter this store. */
export function ensureApproved(kind: DataKind, connection: Connection, disclosure?: string): Promise<boolean> {
	const scope = getAccountScope();
	if (!scope || !connection.keyFingerprint) return Promise.resolve(false);
	const key = connectionKey(connection);
	const previous = read(scope);
	if (previous[connection.id]?.connection !== key) {
		previous[connection.id] = { connection: key, kinds: [] };
		Storage.setItemSync(storageKey(scope), JSON.stringify(previous));
	}
	if (previous[connection.id]?.kinds.includes(kind)) return Promise.resolve(true);
	const flightKey = JSON.stringify([scope, connection.id, key, kind]);
	const existing = pending.get(flightKey);
	if (existing) return existing;
	const result = (async () => {
		if (!presenter) return false;
		const decision = await presenter({ kind, connection, scope, ...(disclosure ? { disclosure } : {}) });
		if (scope !== getAccountScope() || read(scope)[connection.id]?.connection !== key) return false;
		const approved = typeof decision === "boolean" ? decision : decision.approved;
		if (approved && (typeof decision === "boolean" || decision.remember)) {
			const current = read(scope);
			const entry = current[connection.id];
			if (entry && !entry.kinds.includes(kind)) entry.kinds.push(kind);
			Storage.setItemSync(storageKey(scope), JSON.stringify(current));
		}
		return approved;
	})().finally(() => pending.delete(flightKey));
	pending.set(flightKey, result);
	return result;
}
export type RecurringApproval = { connection: string; scope: string };
export function approveRecurring(connection: Connection): RecurringApproval {
	const scope = getAccountScope();
	if (!scope) throw new Error("Sign in again.");
	return { scope, connection: connectionKey(connection) };
}
export function recurringStatus(approval: RecurringApproval, connection: Connection): "active" | "paused" {
	return approval.scope === getAccountScope() && approval.connection === connectionKey(connection)
		? "active"
		: "paused";
}
export function recordRecurringApproval(workId: string, connection: Connection): void {
	const approval = approveRecurring(connection);
	Storage.setItemSync(`recurring:${approval.scope}:${workId}`, JSON.stringify(approval));
}
export function recurringWorkStatus(workId: string, connection: Connection): "active" | "paused" {
	const scope = getAccountScope();
	if (!scope) return "paused";
	const raw = Storage.getItemSync(`recurring:${scope}:${workId}`);
	return raw ? recurringStatus(JSON.parse(raw), connection) : "paused";
}
