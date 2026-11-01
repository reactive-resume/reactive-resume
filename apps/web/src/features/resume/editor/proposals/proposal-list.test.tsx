// @vitest-environment happy-dom
import type { Proposal } from "@reactive-resume/resume/proposals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";

vi.mock("../store", () => ({ useEditorStore: () => () => {} }));
vi.mock("./proposals", () => ({ acceptResumeProposals: () => {} }));
vi.mock("@/features/resume/builder/draft", () => ({ useIsResumeLocked: () => false }));

import { ChangeSet } from "./proposal-list";

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
) {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	render(
		<I18nProvider i18n={i18n}>
			<ChangeSet
				proposals={[proposal]}
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

it("shows an addition as added after its passage, one line per new bullet", () => {
	i18n.loadAndActivate({ locale: "en", messages: {} });
	const addition: Proposal = {
		...proposal,
		id: "add-1",
		before: "<p>Improved checkout-flow accessibility.</p></li>",
		after:
			"<p>Improved checkout-flow accessibility.</p></li><li><p>Led an accessibility audit.</p></li><li><p>Fixed 60 issues.</p></li>",
		unsupported: [],
	};
	render(
		<I18nProvider i18n={i18n}>
			<ChangeSet proposals={[addition]} states={["pending"]} locked={false} onAccept={() => {}} onReject={() => {}} />
		</I18nProvider>,
	);
	expect(screen.getByText("Adds after: Improved checkout-flow accessibility.")).toBeTruthy();
	expect(document.querySelector("del")).toBeNull();
	expect(document.querySelector("ins")?.textContent).toBe("Led an accessibility audit.\nFixed 60 issues.");
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
