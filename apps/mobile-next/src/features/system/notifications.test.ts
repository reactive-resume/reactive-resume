import * as Notifications from "expo-notifications";
import Storage from "expo-sqlite/kv-store";
import { notificationTarget, type Notice } from "./content";
import { syncTodayNotifications } from "./notifications";

jest.mock("@lingui/core", () => ({
	i18n: { _: (value: { message?: string; id: string }) => value.message ?? value.id },
}));
jest.mock("expo-router", () => ({}));
jest.mock("@/data", () => ({}));
jest.mock("@/ui", () => ({ showToast: jest.fn() }));
jest.mock("expo-crypto", () => ({
	CryptoDigestAlgorithm: { SHA256: "sha256" },
	digestStringAsync: async (_algorithm: string, value: string) => `hash-${value}`,
}));
jest.mock("expo-sqlite/kv-store", () => {
	const values = new Map<string, string>();
	return {
		getItemSync: (key: string) => values.get(key) ?? null,
		setItemSync: (key: string, value: string) => values.set(key, value),
		clear: () => values.clear(),
	};
});
jest.mock("expo-notifications", () => ({
	getPermissionsAsync: jest.fn(async () => ({ granted: true })),
	scheduleNotificationAsync: jest.fn(async () => "scheduled"),
	cancelScheduledNotificationAsync: jest.fn(async () => {}),
	dismissNotificationAsync: jest.fn(async () => {}),
	setNotificationCategoryAsync: jest.fn(async () => {}),
}));
const notice: Notice = {
	id: "notice",
	userId: "fixture",
	applicationId: "lumen",
	key: "briefing",
	notice: { type: "briefing", company: "Lumen", role: "Designer" },
	title: "Briefing ready",
	body: "Open briefing",
	url: null,
	readAt: null,
	emailedAt: null,
	emailAttemptedAt: null,
	createdAt: new Date(0),
	updatedAt: new Date(0),
};
beforeEach(() => {
	jest.clearAllMocks();
	Storage.clear();
	jest
		.mocked(Notifications.getPermissionsAsync)
		.mockResolvedValue({ granted: true } as Notifications.NotificationPermissionsStatus);
});
it("does not send when permission or category is off", async () => {
	await syncTodayNotifications("scope", [notice], {}, () => true);
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
	jest
		.mocked(Notifications.getPermissionsAsync)
		.mockResolvedValue({ granted: false } as Notifications.NotificationPermissionsStatus);
	await syncTodayNotifications("scope", [notice], { interviews: true }, () => true);
	expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
});
it("serializes refreshes and persists deduplication per account", async () => {
	await Promise.all([
		syncTodayNotifications("a", [notice], { interviews: true }, () => true),
		syncTodayNotifications("a", [notice], { interviews: true }, () => true),
	]);
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
	await syncTodayNotifications("b", [notice], { interviews: true }, () => true);
	expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
});
it("removes an in-flight notification if its account changes", async () => {
	let current = true;
	jest.mocked(Notifications.scheduleNotificationAsync).mockImplementationOnce(async () => {
		current = false;
		return "scheduled";
	});
	await syncTodayNotifications("a", [notice], { interviews: true }, () => current);
	expect(Notifications.dismissNotificationAsync).toHaveBeenCalledWith("rr-today:hash-a:notice");
});
it("routes notices from typed content, never the server URL", () => {
	expect(notificationTarget({ ...notice, applicationId: "a/b" })).toBe("/applications/a%2Fb/prepare");
	expect(notificationTarget({ ...notice, applicationId: null })).toBeNull();
});
