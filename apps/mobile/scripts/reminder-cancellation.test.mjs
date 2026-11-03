import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeEach, test } from "node:test";
const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const mobileRequire = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = createRequire(serverRequire.resolve("tsx"))("esbuild");
function load(path, mocks) {
	const module = { exports: {} };
	const code = transformSync(readFileSync(new URL(path, import.meta.url), "utf8"), {
		loader: "ts",
		format: "cjs",
	}).code;
	new Function("require", "module", "exports", code)(
		(name) => {
			assert.ok(name in mocks, `Missing boundary: ${name}`);
			return mocks[name];
		},
		module,
		module.exports,
	);
	return module.exports;
}
const schedule = load("../src/features/reminders/schedule.ts", {
	"@reactive-resume/utils/timezone": mobileRequire("@reactive-resume/utils/timezone"),
});
const scheduled = new Map();
let fail = false;
let failSchedule = false;
let failChannel = false;
const platform = { OS: "ios" };
let hold;
let entered = () => {};
const notifications = {
	getPermissionsAsync: async () => ({ granted: true }),
	SchedulableTriggerInputTypes: { DATE: "date" },
	AndroidImportance: { HIGH: "high" },
	setNotificationChannelAsync: async () => {
		if (failChannel) throw new Error("Channel unavailable");
	},
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
	getAllScheduledNotificationsAsync: async () => [...scheduled.values()],
};
const { useReminders } = load("../src/features/reminders/index.ts", {
	"@lingui/core/macro": { t: (parts) => parts.join("") },
	"@tanstack/react-query": {
		useQuery: () => ({ data: new Map() }),
		useQueryClient: () => ({ invalidateQueries: async () => {} }),
	},
	"expo-file-system": {},
	"expo-notifications": notifications,
	"expo-sharing": {},
	"react-native": { Platform: platform },
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
	failChannel = false;
	platform.OS = "ios";
	hold = undefined;
	entered = () => {};
});

for (const failure of ["channel", "schedule"]) {
	test(`failed ${failure} replacement cannot invalidate captured cancellation of the old reminder`, async () => {
		const old = target(`failed-${failure}`);
		const reminders = useReminders(old.applicationId);
		await reminders.turnOn(old, 5);
		const cancel = reminders.captureTurnOff(old);
		platform.OS = "android";
		failChannel = failure === "channel";
		failSchedule = failure === "schedule";
		await assert.rejects(reminders.turnOn(target(old.applicationId, "2035-01-06T10:00:00Z"), 10));
		assert.equal(scheduled.has(schedule.reminderId(old.kind, old.applicationId)), true);
		await cancel();
		assert.equal(scheduled.has(schedule.reminderId(old.kind, old.applicationId)), false);
	});
}
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
