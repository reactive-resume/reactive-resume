// Local, on-device reminders for interviews and follow-ups (owner decision: no push server), and .ics sharing.
// Permission is asked only when the user turns a reminder on. Each reminder's identifier comes from `reminderId`, so
// scheduling again replaces it, and its `data` remembers the lead time and start it was scheduled for.
import type { CalendarEvent } from "./ics";
import type { ReminderKind } from "./schedule";
import { t } from "@lingui/core/macro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import * as Notifications from "expo-notifications";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { buildIcs } from "./ics";
import { reminderId, reminderTime } from "./schedule";

export * from "./ics";
export * from "./schedule";

export type ReminderTarget = {
	kind: ReminderKind;
	applicationId: string;
	entryId?: string | undefined;
	start: Date;
	title: string;
	body: string;
};

type ReminderData = { applicationId: string; lead: number; start: string; title: string; body: string };

export type ScheduleResult = "scheduled" | "denied" | "passed";

const CHANNEL = "reminders";
const queryKey = (applicationId: string) => ["reminders", applicationId] as const;
const idOf = (target: ReminderTarget) => reminderId(target.kind, target.applicationId, target.entryId);
const revisions = new Map<string, number>();
// A failed replacement leaves the old reminder cancellable; only successful platform changes supersede it.
const completed = new Map<string, number>();
const changes = new Map<string, Promise<unknown>>();

// The platform cannot compare-and-cancel: serialize mutations so a delayed retry cannot delete a replacement.
function changeReminder<T>(id: string, change: () => Promise<T>): Promise<T> {
	const next = (changes.get(id) ?? Promise.resolve()).catch(() => undefined).then(change);
	changes.set(id, next);
	const settled = () => {
		if (changes.get(id) === next) changes.delete(id);
	};
	void next.then(settled, settled);
	return next;
}

function cancelReminder(id: string, expected?: number) {
	const revision = (revisions.get(id) ?? 0) + 1;
	revisions.set(id, revision);
	return changeReminder(id, async () => {
		if (expected !== undefined && (completed.get(id) ?? 0) > expected) return;
		await Notifications.cancelScheduledNotificationAsync(id);
		completed.set(id, revision);
	});
}

/** Asks for permission only if it hasn't been answered; false when notifications are off. */
async function requestPermission() {
	const current = await Notifications.getPermissionsAsync();
	if (current.granted) return true;
	if (!current.canAskAgain) return false;
	return (await Notifications.requestPermissionsAsync()).granted;
}

async function scheduleNative(target: ReminderTarget, lead: number): Promise<ScheduleResult> {
	const id = idOf(target);
	const at = reminderTime(target.start, lead);
	if (!at) {
		await Notifications.cancelScheduledNotificationAsync(id);
		return "passed";
	}
	if (Platform.OS === "android") {
		await Notifications.setNotificationChannelAsync(CHANNEL, {
			name: t`Reminders`,
			importance: Notifications.AndroidImportance.HIGH,
		});
	}
	const data: ReminderData = {
		applicationId: target.applicationId,
		lead,
		start: target.start.toISOString(),
		title: target.title,
		body: target.body,
	};
	await Notifications.scheduleNotificationAsync({
		identifier: id,
		content: { title: target.title, body: target.body, data },
		trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId: CHANNEL },
	});
	return "scheduled";
}

function schedule(target: ReminderTarget, lead: number): Promise<ScheduleResult> {
	const id = idOf(target);
	const revision = (revisions.get(id) ?? 0) + 1;
	revisions.set(id, revision);
	return changeReminder(id, async () => {
		const result = await scheduleNative(target, lead);
		completed.set(id, revision);
		return result;
	});
}

/** Reminders scheduled on this device for one application: notification identifier → lead minutes. */
async function scheduledFor(applicationId: string) {
	const all = await Notifications.getAllScheduledNotificationsAsync();
	return all.flatMap((request) => {
		const data = request.content.data as Partial<ReminderData> | null;
		return data?.applicationId === applicationId && typeof data.lead === "number"
			? [{ id: request.identifier, data: data as ReminderData }]
			: [];
	});
}

/** The application's reminders, and actions to turn one on (asking permission then) or off. */
export function useReminders(applicationId: string) {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: queryKey(applicationId),
		queryFn: async () => new Map((await scheduledFor(applicationId)).map(({ id, data }) => [id, data.lead] as const)),
		enabled: !!applicationId,
	});
	const refresh = () => queryClient.invalidateQueries({ queryKey: queryKey(applicationId) });

	return {
		/** Lead minutes of the reminder for this target, or null when none is scheduled. */
		leadFor: (target: Pick<ReminderTarget, "kind" | "applicationId" | "entryId">) =>
			query.data?.get(reminderId(target.kind, target.applicationId, target.entryId)) ?? null,
		turnOn: async (target: ReminderTarget, lead: number): Promise<ScheduleResult> => {
			if (!(await requestPermission())) return "denied";
			const result = await schedule(target, lead);
			await refresh();
			return result;
		},
		turnOff: async (target: Pick<ReminderTarget, "kind" | "applicationId" | "entryId">) => {
			await cancelReminder(reminderId(target.kind, target.applicationId, target.entryId));
			await refresh();
		},
		/** Retain this cancellation across retries; a later local schedule makes it inert. */
		captureTurnOff: (target: Pick<ReminderTarget, "kind" | "applicationId" | "entryId">) => {
			const id = reminderId(target.kind, target.applicationId, target.entryId);
			const expected = revisions.get(id) ?? 0;
			return async () => {
				await cancelReminder(id, expected);
				await refresh();
			};
		},
	};
}

/** Reminders of interviews hidden behind an undo toast: sync leaves them alone until the delete commits or is undone. */
const held = new Set<string>();
export const holdReminder = (entryId: string) => held.add(reminderId("interview", "", entryId));
export const releaseReminder = (entryId: string) => held.delete(reminderId("interview", "", entryId));

/**
 * Keeps scheduled reminders in step with the application: an interview moved (here or on the web) moves its reminder,
 * a deleted interview, cleared follow-up or closed application cancels it. Never asks for permission.
 */
export async function syncReminders(applicationId: string, targets: ReminderTarget[]) {
	const byId = new Map(targets.map((target) => [idOf(target), target]));
	for (const { id, data } of await scheduledFor(applicationId)) {
		if (held.has(id)) continue;
		const target = byId.get(id);
		if (!target) await cancelReminder(id);
		else if (data.start !== target.start.toISOString() || data.title !== target.title || data.body !== target.body)
			await schedule(target, data.lead);
	}
}

/** Shares one event as an .ics file through the system share sheet; no calendar permission is needed. */
export async function shareIcs(event: CalendarEvent, fileName: string, method: "PUBLISH" | "CANCEL" = "PUBLISH") {
	// The previous share's file can go now: recipients have read it once shareAsync resolved.
	for (const entry of Paths.cache.list()) {
		if (entry instanceof File && entry.name.endsWith(".ics")) entry.delete();
	}
	if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable");
	const file = new File(Paths.cache, fileName);
	await file.write(buildIcs(event, new Date(), method));
	await Sharing.shareAsync(file.uri, { mimeType: "text/calendar", UTI: "com.apple.ical.ics" });
}
