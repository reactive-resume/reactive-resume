import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { load, mobileRequire } from "./harness.mjs";
const schedule = load("../src/features/reminders/schedule.ts", {
	"@reactive-resume/utils/timezone": mobileRequire("@reactive-resume/utils/timezone"),
});
const scheduled = new Map();
let fail = false;
let failSchedule = false;
let hold;
let entered = () => {};
let readHold;
let readEntered = () => {};
const notifications = {
	getPermissionsAsync: async () => ({ granted: true }),
	SchedulableTriggerInputTypes: { DATE: "date" },
	scheduleNotificationAsync: async (request) => {
		if (hold) {
			entered();
			await hold;
		}
		if (failSchedule) throw new Error("Schedule unavailable");
		scheduled.set(request.identifier, request);
	},
	cancelScheduledNotificationAsync: async (id) => {
		if (fail) {
			fail = false;
			throw new Error("Notification service unavailable");
		}
		scheduled.delete(id);
	},
	getAllScheduledNotificationsAsync: async () => {
		const snapshot = [...scheduled.values()];
		readEntered();
		if (readHold) await readHold;
		return snapshot;
	},
};
const { useReminders, syncReminders } = load("../src/features/reminders/index.ts", {
	"@lingui/core/macro": { t: (parts) => parts.join("") },
	"@tanstack/react-query": {
		useQuery: () => ({ data: new Map() }),
		useQueryClient: () => ({ invalidateQueries: async () => {} }),
	},
	"expo-file-system": {},
	"expo-notifications": notifications,
	"expo-sharing": {},
	"react-native": { Platform: { OS: "ios" } },
	"./ics": {},
	"./schedule": schedule,
});
const target = (id, start = "2035-01-02T09:00:00Z") => ({
	kind: "follow-up",
	applicationId: id,
	start: new Date(start),
	title: "Fictional follow-up",
	body: "Review reply",
});
beforeEach(() => {
	scheduled.clear();
	fail = false;
	failSchedule = false;
	hold = undefined;
	entered = () => {};
	readHold = undefined;
	readEntered = () => {};
});

for (const timing of ["before", "during"]) {
	for (const action of ["clear", "move"]) {
		test(`reconciliation ${action} respects a reminder request begun ${timing} its notification read`, async () => {
			const old = target(`sync-${timing}-${action}`);
			const reminders = useReminders(old.applicationId);
			await reminders.turnOn(old, 5);
			let releaseSchedule;
			hold = new Promise((resolve) => {
				releaseSchedule = resolve;
			});
			const scheduleArrival = new Promise((resolve) => {
				entered = resolve;
			});
			let releaseRead;
			readHold = new Promise((resolve) => {
				releaseRead = resolve;
			});
			const readArrival = new Promise((resolve) => {
				readEntered = resolve;
			});
			const newer = target(old.applicationId, "2035-01-09T10:00:00Z");
			let replacing;
			if (timing === "before") {
				replacing = reminders.turnOn(newer, 10);
				await scheduleArrival;
			}
			const syncing = syncReminders(
				old.applicationId,
				action === "clear" ? [] : [target(old.applicationId, "2035-01-03T11:00:00Z")],
			);
			await readArrival;
			if (timing === "during") {
				replacing = reminders.turnOn(newer, 10);
				await scheduleArrival;
			}
			releaseRead();
			releaseSchedule();
			await replacing;
			await syncing;
			const saved = scheduled.get(schedule.reminderId(old.kind, old.applicationId));
			if (timing === "during") {
				assert.equal(saved?.content.data.start, newer.start.toISOString());
				assert.equal(saved?.content.data.lead, 10);
			} else if (action === "clear") {
				assert.equal(saved, undefined);
			} else {
				assert.equal(saved?.content.data.start, "2035-01-03T11:00:00.000Z");
				assert.equal(saved?.content.data.lead, 5);
			}
		});
	}
}

test("unchanged reconciliation still moves and cancels the observed reminder", async () => {
	const old = target("sync-current");
	const reminders = useReminders(old.applicationId);
	await reminders.turnOn(old, 5);
	const moved = target(old.applicationId, "2035-01-06T10:00:00Z");
	await syncReminders(old.applicationId, [moved]);
	assert.equal(
		scheduled.get(schedule.reminderId(old.kind, old.applicationId))?.content.data.start,
		moved.start.toISOString(),
	);
	await syncReminders(old.applicationId, []);
	assert.equal(scheduled.has(schedule.reminderId(old.kind, old.applicationId)), false);
});

test("failed replacement cannot invalidate captured cancellation of the old reminder", async () => {
	const old = target("failed-schedule");
	const reminders = useReminders(old.applicationId);
	await reminders.turnOn(old, 5);
	const cancel = reminders.captureTurnOff(old);
	failSchedule = true;
	await assert.rejects(reminders.turnOn(target(old.applicationId, "2035-01-06T10:00:00Z"), 10));
	assert.equal(scheduled.has(schedule.reminderId(old.kind, old.applicationId)), true);
	await cancel();
	assert.equal(scheduled.has(schedule.reminderId(old.kind, old.applicationId)), false);
});
test("captured cancellation Retry cannot remove a newer scheduled follow-up", async () => {
	const old = target("replacement");
	const reminders = useReminders(old.applicationId);
	await reminders.turnOn(old, 5);
	const cancel = reminders.captureTurnOff(old);
	fail = true;
	await assert.rejects(cancel);
	const newer = target(old.applicationId, "2035-01-03T10:00:00Z");
	await reminders.turnOn(newer, 10);
	await cancel();
	assert.equal(
		scheduled.get(schedule.reminderId(old.kind, old.applicationId)).content.data.start,
		newer.start.toISOString(),
	);
});
test("a queued replacement and delayed Retry serialize without deleting the replacement", async () => {
	const old = target("queued");
	const reminders = useReminders(old.applicationId);
	await reminders.turnOn(old, 5);
	const cancel = reminders.captureTurnOff(old);
	fail = true;
	await assert.rejects(cancel);
	let release;
	hold = new Promise((resolve) => {
		release = resolve;
	});
	const arrival = new Promise((resolve) => {
		entered = resolve;
	});
	const newer = target(old.applicationId, "2035-01-04T11:00:00Z");
	const replacing = reminders.turnOn(newer, 10);
	await arrival;
	const retry = cancel();
	release();
	await replacing;
	await retry;
	assert.equal(
		scheduled.get(schedule.reminderId(old.kind, old.applicationId)).content.data.start,
		newer.start.toISOString(),
	);
});
test("an unchanged failed cancellation retries and preserves an interview reminder", async () => {
	const old = target("retry");
	const reminders = useReminders(old.applicationId);
	await reminders.turnOn(old, 5);
	const interview = { ...old, kind: "interview", entryId: "interview" };
	await reminders.turnOn(interview, 10);
	const cancel = reminders.captureTurnOff(old);
	fail = true;
	await assert.rejects(cancel);
	await cancel();
	assert.equal(scheduled.has(schedule.reminderId(old.kind, old.applicationId)), false);
	assert.equal(scheduled.has(schedule.reminderId(interview.kind, interview.applicationId, interview.entryId)), true);
});

test("a cancellation captured after a schedule starts clears that exact in-flight schedule", async () => {
	const old = target("capture-in-flight");
	const reminders = useReminders(old.applicationId);
	await reminders.turnOn(old, 5);
	let release;
	hold = new Promise((resolve) => {
		release = resolve;
	});
	const arrival = new Promise((resolve) => {
		entered = resolve;
	});
	const replacing = reminders.turnOn(target(old.applicationId, "2035-01-05T11:00:00Z"), 10);
	await arrival;
	const cancel = reminders.captureTurnOff(old);
	const clearing = cancel();
	release();
	await replacing;
	await clearing;
	assert.equal(scheduled.has(schedule.reminderId(old.kind, old.applicationId)), false);
});
