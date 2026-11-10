import { t } from "@lingui/core/macro";
import { digestStringAsync, CryptoDigestAlgorithm } from "expo-crypto";
import * as Notifications from "expo-notifications";
import { useRouter, useRootNavigationState } from "expo-router";
import Storage from "expo-sqlite/kv-store";
import { useEffect } from "react";
import { Platform } from "react-native";
import { noticeCategory, notificationCategories, notificationTarget, type Notice } from "./content";
import { useDataBackend, useSettings, useToday } from "@/data";
import { showToast } from "@/ui";

export async function requestLocalNotifications() {
	return (await Notifications.requestPermissionsAsync()).granted;
}
const prefix = "rr-today:";
let flight: Promise<void> = Promise.resolve();
/** Serialize refreshes so one unread notice cannot schedule twice during concurrent Today refetches. */
export function syncTodayNotifications(
	scope: string,
	notices: readonly Notice[],
	preferences: Record<string, boolean>,
	current: () => boolean,
) {
	const run = flight
		.catch(() => undefined)
		.then(async () => {
			const account = await digestStringAsync(CryptoDigestAlgorithm.SHA256, scope);
			if (!current()) return;
			const ledgerKey = `${prefix}${account}`;
			const seen = new Set<string>(JSON.parse(Storage.getItemSync(ledgerKey) ?? "[]"));
			const allowed = (await Notifications.getPermissionsAsync()).granted;
			if (!current()) return;
			const labels = notificationCategories();
			for (const [id, name] of Object.entries(labels)) {
				if (!current()) return;
				if (Platform.OS === "android")
					await Notifications.setNotificationChannelAsync(id, {
						name,
						importance: Notifications.AndroidImportance.DEFAULT,
					});
				await Notifications.setNotificationCategoryAsync(id, []);
			}
			for (const notice of notices) {
				const category = noticeCategory(notice);
				const href = notificationTarget(notice);
				const identifier = `${prefix}${account}:${notice.id}`;
				if (!current()) return;
				if (!allowed || !category || preferences[category] !== true || notice.readAt || !href) {
					await Notifications.cancelScheduledNotificationAsync(identifier);
					continue;
				}
				if (seen.has(notice.id)) continue;
				await Notifications.scheduleNotificationAsync({
					identifier,
					content: { title: notice.title, body: notice.body, categoryIdentifier: category, data: { href, account } },
					trigger: Platform.OS === "android" ? { channelId: category } : null,
				});
				if (!current()) {
					await Notifications.cancelScheduledNotificationAsync(identifier);
					await Notifications.dismissNotificationAsync(identifier);
					return;
				}
				seen.add(notice.id);
				Storage.setItemSync(ledgerKey, JSON.stringify([...seen]));
			}
		});
	flight = run;
	return run;
}

/** Lead mounts once under DataProvider, after session restoration. No push token or remote push registration. */
export function TodayNotifications() {
	const today = useToday();
	const settings = useSettings();
	const { scope, backend } = useDataBackend();
	const router = useRouter();
	const ready = !!useRootNavigationState()?.key;
	const response = Notifications.useLastNotificationResponse();
	useEffect(() => {
		if (!scope || backend.kind !== "real" || !today.notifications.data || !settings.data) return;
		let current = true;
		void syncTodayNotifications(
			scope,
			today.notifications.data,
			settings.data.notificationCategories,
			() => current,
		).catch(() => {
			if (current) showToast({ message: t`Notifications couldn't sync. Today still shows everything.` });
		});
		return () => {
			current = false;
		};
	}, [scope, backend.kind, today.notifications.data, settings.data]);
	useEffect(() => {
		if (!scope || backend.kind !== "real" || !ready || !response) return;
		let current = true;
		void digestStringAsync(CryptoDigestAlgorithm.SHA256, scope)
			.then((account) => {
				if (!current) return;
				const data = response.notification.request.content.data;
				Notifications.clearLastNotificationResponse();
				if (data?.account !== account) return;
				const href = data.href;
				if (
					typeof href !== "string" ||
					!/^\/(?:applications\/[^/]+\/(?:prepare|messages)|\?section=new-roles)$/.test(href)
				)
					return;
				router.replace(href.startsWith("/applications") ? "/applications" : "/");
				router.push(href);
			})
			.catch(() => {
				if (current) showToast({ message: t`Couldn't open this notification. Open Today to continue.` });
			});
		return () => {
			current = false;
		};
	}, [scope, backend.kind, ready, response, router]);
	useEffect(() => {
		if (!scope || backend.kind !== "real") return;
		return () => {
			const cleanup = flight
				.catch(() => undefined)
				.then(async () => {
					const account = await digestStringAsync(CryptoDigestAlgorithm.SHA256, scope);
					const owned = `${prefix}${account}:`;
					const requests = await Notifications.getAllScheduledNotificationsAsync();
					for (const request of requests)
						if (request.identifier.startsWith(owned))
							await Notifications.cancelScheduledNotificationAsync(request.identifier);
					const delivered = await Notifications.getPresentedNotificationsAsync();
					for (const notification of delivered)
						if (notification.request.identifier.startsWith(owned))
							await Notifications.dismissNotificationAsync(notification.request.identifier);
				});
			flight = cleanup.catch(() => {
				showToast({ message: t`Couldn't clear local notifications. Clear them in your device settings.` });
			});
		};
	}, [scope, backend.kind]);
	return null;
}
