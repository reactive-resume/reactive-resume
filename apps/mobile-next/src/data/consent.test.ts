const mockValues = new Map<string, string>();
let mockScope: string | null = "alex";
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: {
		getItemSync: (key: string) => mockValues.get(key) ?? null,
		setItemSync: (key: string, value: string) => mockValues.set(key, value),
		removeItemSync: (key: string) => mockValues.delete(key),
	},
}));
jest.mock("@/auth/session", () => ({ getAccountScope: () => mockScope }));
import { ensureApproved, setConsentPresenter, approveRecurring, recurringStatus } from "./consent";
test("approval is per account, connection and kind; key changes reset it and pause recurring work", async () => {
	const presenter = jest.fn(async () => true);
	setConsentPresenter(presenter);
	const connection = { id: "work", provider: "openai", host: "https://api.openai.com", keyFingerprint: "v1" };
	await ensureApproved("file", connection);
	await ensureApproved("file", connection);
	expect(presenter).toHaveBeenCalledTimes(1);
	await ensureApproved("audio", connection);
	expect(presenter).toHaveBeenCalledTimes(2);
	const approval = approveRecurring(connection);
	const changed = { ...connection, keyFingerprint: "v2" };
	expect(recurringStatus(approval, changed)).toBe("paused");
	await ensureApproved("file", changed);
	expect(presenter).toHaveBeenCalledTimes(3);
	await ensureApproved("file", connection);
	expect(presenter).toHaveBeenCalledTimes(4);
	mockScope = "other";
	await ensureApproved("file", connection);
	expect(presenter).toHaveBeenCalledTimes(5);
});
test("account switch while presenter is open cannot approve another account", async () => {
	mockScope = "alex";
	setConsentPresenter(async () => {
		mockScope = "other";
		return true;
	});
	expect(
		await ensureApproved("chat", { id: "work", provider: "openai", host: "api.openai.com", keyFingerprint: "v3" }),
	).toBe(false);
});
