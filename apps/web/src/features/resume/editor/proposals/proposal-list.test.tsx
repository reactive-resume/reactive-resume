// @vitest-environment happy-dom
import type { Proposal } from "@reactive-resume/resume/proposals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

vi.mock("../store", () => ({ useEditorStore: () => () => {} }));
vi.mock("./proposals", () => ({ acceptResumeProposals: () => {} }));
vi.mock("@/features/resume/builder/draft", () => ({ useIsResumeLocked: () => false }));

import { ChangeSet, changeParts, Coverage, inContext } from "./proposal-list";

afterEach(cleanup);

const proposal: Proposal = {
	id: "edit-1",
	target: { sectionId: "experience", itemId: "lumen", field: "description" },
	location: "Experience · Lumen Health · bullet 1",
	before: "<p>Built the design system</p>",
	after: "<p>Led Kubernetes operations at Invented Corp</p>",
	why: "Answers the platform requirement.",
	status: "pending",
	source: "assistant",
	requirement: "Kubernetes operations",
	evidence: [
		{ kind: "passage", location: "Experience · Lumen Health · bullet 2", text: "Ran usability sessions" },
		{ kind: "fact", id: "forgotten" },
	],
	unsupported: [{ kind: "term", text: "Kubernetes" }],
};

function renderSet(
	handlers: { onAccept?: () => void; onEdit?: (proposal: Proposal, text: string) => Promise<void> } = {},
	overrides: Partial<Proposal> = {},
) {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	render(
		<I18nProvider i18n={i18n}>
			<ChangeSet
				proposals={[{ ...proposal, ...overrides }]}
				states={["pending"]}
				locked={false}
				onAccept={handlers.onAccept ?? (() => {})}
				onReject={() => {}}
				onEdit={handlers.onEdit ?? (async () => {})}
				factText={() => null}
				requirements={[
					{ text: "Kubernetes operations", status: "edited", evidence: [] },
					{ text: "Accessibility audits", status: "missing", evidence: [] },
				]}
			/>
		</I18nProvider>,
	);
}

it("shows citations as unverified, flags what nothing backs, and keeps requirement gaps visible", () => {
	renderSet();

	expect(screen.queryByText(/Backed by/)).toBeNull();
	expect(screen.getByText("The assistant cites 2 sources · check they say this")).toBeTruthy();
	expect(screen.getByText("A fact that's no longer in Knowledge")).toBeTruthy();
	expect(screen.getByText("Not in your resume: Kubernetes")).toBeTruthy();
	expect(screen.getByText("Accessibility audits")).toBeTruthy();
	expect(screen.getByText("No evidence found · left as a gap")).toBeTruthy();
});

it("saves the user's wording without accepting, and typing it never triggers a shortcut", () => {
	const onAccept = vi.fn();
	const onEdit = vi.fn(async () => {});
	renderSet({ onAccept, onEdit });

	fireEvent.click(screen.getByRole("button", { name: "Edit" }));
	const box = screen.getByLabelText("Your wording");
	expect((box as HTMLTextAreaElement).value).toBe("Led Kubernetes operations at Invented Corp");
	fireEvent.change(box, { target: { value: "Led design system work" } });
	fireEvent.keyDown(box, { key: "a" });
	fireEvent.click(screen.getByRole("button", { name: "Save wording" }));

	expect(onEdit).toHaveBeenCalledWith(proposal, "Led design system work");
	expect(onAccept).not.toHaveBeenCalled();
});

it("keeps an edit whose wording is open, saving or unsaved out of Accept all and the A key", async () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const onAccept = vi.fn();
	let finishSave: () => void = () => {};
	const onEdit = vi.fn(() => new Promise<void>((resolve) => (finishSave = resolve)));
	const second = {
		...proposal,
		id: "edit-2",
		location: "Summary",
		before: "<p>Second</p>",
		after: "<p>Second new</p>",
	};
	render(
		<I18nProvider i18n={i18n}>
			<ChangeSet
				proposals={[proposal, second]}
				states={["pending", "pending"]}
				locked={false}
				onAccept={onAccept}
				onReject={() => {}}
				onEdit={onEdit}
			/>
		</I18nProvider>,
	);
	expect(screen.getByRole("button", { name: "Accept all" })).toBeTruthy();

	const [first] = screen.getAllByRole("button", { name: "Edit" });
	if (!first) throw new Error("Expected Edit");
	fireEvent.click(first);
	fireEvent.change(screen.getByLabelText("Your wording"), { target: { value: "My corrected wording" } });
	fireEvent.click(screen.getByRole("button", { name: "Save wording" }));
	// Saving: Accept all leaves out the edit being saved, and A on it does nothing.
	expect(screen.queryByRole("button", { name: "Accept all" })).toBeNull();
	const items = document.querySelectorAll("[data-proposal-index]");
	fireEvent.keyDown(items[0] as HTMLElement, { key: "a" });
	expect(onAccept).not.toHaveBeenCalled();
	fireEvent.keyDown(items[1] as HTMLElement, { key: "a" });
	expect(onAccept).toHaveBeenCalledWith([second]);

	finishSave();
	await vi.waitFor(() => expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(2));
});

it("offers no Edit for a structural change, which is reviewed and applied whole", () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const structural: Proposal = {
		...proposal,
		id: "structure",
		target: { sectionId: "resume", field: "data" },
		location: "Resume",
		before: "Basics · headline\n—",
		after: "Basics · headline\nDesign lead",
		snapshot: { before: "{}", after: "{}" },
	};
	render(
		<I18nProvider i18n={i18n}>
			<ChangeSet
				proposals={[structural]}
				states={["pending"]}
				locked={false}
				onAccept={() => {}}
				onReject={() => {}}
				onEdit={async () => {}}
			/>
		</I18nProvider>,
	);
	expect(screen.getByText(/Design lead/)).toBeTruthy();
	expect(screen.getByRole("button", { name: "Accept" })).toBeTruthy();
	expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
});

it("leaves edits that add a detail out of Accept all and labels a replaced suggestion", () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const onAccept = vi.fn();
	const plain = (id: string): Proposal => ({ ...proposal, id, unsupported: [] });
	render(
		<I18nProvider i18n={i18n}>
			<ChangeSet
				proposals={[
					plain("a"),
					plain("b"),
					{ ...plain("c"), addsClaims: true },
					{ ...plain("d"), status: "rejected", superseded: true },
				]}
				states={["pending", "pending", "pending", "rejected"]}
				locked={false}
				onAccept={onAccept}
				onReject={() => {}}
			/>
		</I18nProvider>,
	);
	expect(screen.getByText("New detail: check it's true")).toBeTruthy();
	expect(screen.getByText("Replaced by a newer suggestion")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Accept the others" }));
	expect(onAccept).toHaveBeenCalledWith([expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })]);
});

it("checks identical posting gaps independently", () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const requirements = ["missing", "unassessed"].map((status) => ({
		text: "Accessibility audits",
		status: status as "missing" | "unassessed",
		evidence: [],
	}));
	render(
		<I18nProvider i18n={i18n}>
			<Coverage requirements={requirements} factText={() => null} />
		</I18nProvider>,
	);
	const [first, second] = screen.getAllByRole("checkbox", { name: "Accessibility audits" });
	if (!first || !second) throw new Error("Both requirements must render");
	const input = first.parentElement?.querySelector("input");
	if (!input) throw new Error("First checkbox input missing");
	fireEvent.click(input);
	expect(first.getAttribute("aria-checked")).toBe("true");
	expect(second.getAttribute("aria-checked")).toBe("false");
	expect(requirements.map((item) => item.status)).toEqual(["missing", "unassessed"]);
});

it("shows a clause added to a short bullet as the sentence once, with only the new words marked", () => {
	expect(
		changeParts(
			"Run more than 40 customer interviews a year.",
			"Run more than 40 customer interviews a year, and plan each quarter's design work from what they show.",
		),
	).toEqual([
		{ kind: "same", text: "Run more than 40 customer interviews a year" },
		{ kind: "added", text: ", and plan each quarter's design work from what they show" },
		{ kind: "same", text: "." },
	]);
	// A changed word is never split: "launch" → "launched" marks the whole word.
	expect(changeParts("We launch it.", "We launched it.")).toEqual([
		{ kind: "same", text: "We " },
		{ kind: "removed", text: "launch " },
		{ kind: "added", text: "launched " },
		{ kind: "same", text: "it." },
	]);
});

it("shrinks long kept text around a change on the narrow card, and keeps every changed word", () => {
	const long = "one two three four five six seven eight nine ten eleven twelve ";
	const parts = inContext([
		{ kind: "same", text: long },
		{ kind: "added", text: "new words " },
		{ kind: "same", text: long.trim() },
	]);
	expect(parts.map((part) => part.text).join("")).toBe(
		"…seven eight nine ten eleven twelve new words one two three four five six …",
	);
	expect(parts[1]).toEqual({ kind: "added", text: "new words " });
	// A short sentence opening stays whole instead of losing its first words.
	const opening = "Tested each release with shop owners before it shipped";
	expect(
		inContext([
			{ kind: "same", text: opening },
			{ kind: "added", text: ", so problems surfaced" },
		])[0]?.text,
	).toBe(opening);
});

it("keeps unverified new details visible before accepting, without opening a disclosure", () => {
	renderSet({}, { addsClaims: true, unsupported: [{ kind: "figure", text: "58% activation" }] });
	expect(screen.getByText("Figure: 58% activation")).toBeVisible();
	expect(screen.getByText("Nothing checked backs these. Confirm each before accepting:")).toBeVisible();
});
