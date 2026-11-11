import type { RouterInput } from "@/api/client";
import { t } from "@lingui/core/macro";
import { dataClient } from "./client";
import { timeZone } from "./clock";
import { useSettings } from "./collections";
import { approveRecurring, recordRecurringApproval, type Connection } from "./consent";
import { useLocalValue } from "./local-state";
import { useAccount } from "./provider";
import { getAccountScope } from "@/auth/session";
/** Caller shows connection/data/cost beside the switch; saving is its explicit approval. */
export async function saveApprovedSchedule(input: RouterInput["career"]["saveSchedule"], connection: Connection) {
	const approval = approveRecurring(connection);
	const saved = await dataClient.career.saveSchedule(input, {
		context: { recurringApproval: approval, scope: approval.scope },
	});
	if (getAccountScope() !== approval.scope) throw new Error(t`The account changed. Try again.`);
	recordRecurringApproval(saved.id, connection);
	return saved;
}

export type ScheduleFrequency = { kind: "interval"; days: number } | { kind: "weekdays"; days: number[] };
export function validateFrequency(value: ScheduleFrequency) {
	if (
		value.kind === "interval"
			? !Number.isInteger(value.days) || value.days < 1 || value.days > 30
			: !value.days.length ||
				new Set(value.days).size !== value.days.length ||
				value.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
	)
		throw new Error(t`Invalid schedule frequency.`);
	return value;
}
export function useScheduleFrequency(id: string) {
	const local = useLocalValue<ScheduleFrequency>(`schedule-frequency:${id}`, { kind: "interval", days: 1 });
	return {
		frequency: local.value,
		save: (value: ScheduleFrequency) => local.set(validateFrequency(value)),
		serverChangeNeeded: "career.saveSchedule: add weekdays" as const,
	};
}
export function scheduleNextRun(schedule: { enabled: boolean; nextRunAt: Date; timezone: string }, locale = "en-GB") {
	return {
		at: schedule.nextRunAt,
		timezone: schedule.timezone,
		enabled: schedule.enabled,
		label: new Intl.DateTimeFormat(locale, {
			timeZone: schedule.timezone,
			weekday: "long",
			hour: "2-digit",
			minute: "2-digit",
			timeZoneName: "short",
		}).format(schedule.nextRunAt),
	};
}
export function useScheduleEmailState() {
	const account = useAccount();
	return { account, verified: account.data?.emailVerified, canEnableEmail: account.data?.emailVerified === true };
}
/** `current` is the phone's zone; storyboard flows pass another one to reach the notice. */
export function useTravelNotice(current = timeZone()) {
	const settings = useSettings();
	return {
		current,
		home: settings.data?.homeTimeZone,
		show:
			!!settings.data?.automaticTimeZone &&
			current !== settings.data.homeTimeZone &&
			current !== settings.data.lastNotifiedTimeZone,
		acknowledge: () => settings.save({ lastNotifiedTimeZone: current }),
		/** Moves the schedules' home zone (this device and the account) to the phone's. */
		move: () => settings.save({ homeTimeZone: current, lastNotifiedTimeZone: current }),
	};
}
