// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { fixtureForm, fixturePacket } from "./fixture";
import { fillControlledForm } from "./prototype";

beforeEach(() => {
	window.location.href = "http://127.0.0.1:3075/greenhouse";
	document.body.innerHTML = fixtureForm("greenhouse");
});

describe("RX-75 controlled-form prototype (not employer support)", () => {
	it.each(["greenhouse", "lever", "ashby"] as const)(
		"fills reviewed contact and scoped answers: %s fixture",
		async (kind) => {
			document.body.innerHTML = fixtureForm(kind);
			const packet = fixturePacket();
			// File transfer is measured in real browsers, not happy-dom's emulation.
			packet.documents = [];
			const report = await fillControlledForm(document, packet);
			expect(document.querySelector<HTMLInputElement>('[autocomplete="email"]')?.value).toBe("maya@example.test");
			expect(document.querySelector<HTMLTextAreaElement>("#motivation")?.value).toBe("I build accessible tools.");
			expect(document.querySelector<HTMLInputElement>("#authorization")?.value).toBe("");
			expect(report.fields.find((field) => field.field === "authorization")).toMatchObject({ status: "manual" });
			expect(report.fields.find((field) => field.field === "motivation")?.source).toBe(
				"Saved answer answer-1 revision 2 (manual)",
			);
			expect(report.fields.find((field) => field.field === "experience")?.source).toBe(
				"Resume resume-75 version resume-v3",
			);
		},
	);

	it("keeps existing entries and reports custom, account, captcha and next-page handoffs", async () => {
		const email = document.querySelector<HTMLInputElement>('[autocomplete="email"]');
		if (!email) throw new Error("Missing email fixture.");
		email.value = "reviewed-on-form@example.test";
		const report = await fillControlledForm(document, fixturePacket());
		expect(email.value).toBe("reviewed-on-form@example.test");
		expect(report.fields.find((field) => field.field === email.id)?.status).toBe("skipped");
		expect(report.fields.filter((field) => field.status === "manual").map((field) => field.field)).toEqual(
			expect.arrayContaining(["authorization", "country", "account", "captcha", "next-page"]),
		);
	});

	it.each(["scope", "stale", "revision"] as const)("rejects unavailable reviewed answers: %s", async (change) => {
		const packet = fixturePacket();
		const answer = packet.answers[0];
		if (!answer) throw new Error("Missing answer fixture.");
		if (change === "scope") answer.applicationId = "other-application";
		if (change === "stale") answer.stale = true;
		if (change === "revision") answer.revision++;
		const report = await fillControlledForm(document, packet);
		expect(document.querySelector<HTMLTextAreaElement>("#motivation")?.value).toBe("");
		expect(report.fields.find((field) => field.field === "motivation")?.status).toBe("manual");
	});

	it("rejects wrong resume versions before filling", async () => {
		const packet = fixturePacket();
		packet.resume.version = "resume-v4";
		await expect(fillControlledForm(document, packet)).rejects.toThrow("Selected resume changed");
		expect(document.querySelector<HTMLInputElement>('[autocomplete="email"]')?.value).toBe("");
	});

	it("requires a reviewed profile record before filling", async () => {
		const packet = fixturePacket();
		packet.profile.reviewedAt = "";
		await expect(fillControlledForm(document, packet)).rejects.toThrow();
		expect(document.querySelector<HTMLInputElement>('[autocomplete="email"]')?.value).toBe("");
	});

	it.each(["duplicate", "disabled"] as const)("hands ambiguous or disabled fields back to user: %s", async (change) => {
		const email = document.querySelector<HTMLInputElement>("#email");
		if (!email) throw new Error("Missing fixture email.");
		if (change === "duplicate") email.after(email.cloneNode());
		else email.disabled = true;
		const report = await fillControlledForm(document, fixturePacket());
		expect(email.value).toBe("");
		expect(report.fields.find((field) => field.field === (change === "duplicate" ? "#email" : "email"))?.status).toBe(
			"manual",
		);
	});

	it("refuses real employer origins and arbitrary localhost forms", async () => {
		window.location.href = "https://boards.greenhouse.io/example/jobs/75";
		await expect(fillControlledForm(document, fixturePacket())).rejects.toThrow("loopback synthetic forms only");
		window.location.href = "http://127.0.0.1:3075/";
		document.querySelector("form")?.removeAttribute("data-rx75-synthetic");
		await expect(fillControlledForm(document, fixturePacket())).rejects.toThrow("loopback synthetic forms only");
	});

	it("does not emit input, change, click or submit events", async () => {
		const events: string[] = [];
		for (const type of ["input", "change", "click", "submit"])
			document.addEventListener(type, () => events.push(type), { once: true });
		await fillControlledForm(document, fixturePacket());
		expect(events).toEqual([]);
	});
});
