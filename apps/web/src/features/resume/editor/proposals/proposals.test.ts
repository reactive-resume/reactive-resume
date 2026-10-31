import type { Proposal } from "@reactive-resume/resume/proposals";
import type { ResumeData } from "@reactive-resume/schema/resume/data";
import { describe, expect, it, vi } from "vite-plus/test";
import { i18n } from "@lingui/core";
import { produce } from "immer";
import {
	applyProposal,
	canApply,
	getProposalState,
	readTarget,
	replaceBlockText,
} from "@reactive-resume/resume/proposals";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
const mocks = vi.hoisted(() => ({ store: vi.fn(), toast: vi.fn() }));
vi.mock("@/features/resume/builder/draft", () => ({ useResumeStore: { getState: mocks.store } }));
vi.mock("@reactive-resume/ui/components/toast", () => ({ toast: { add: mocks.toast } }));

import { acceptResumeProposals, markProposals } from "./proposals";

const OLD_BULLET = "<li><p>Responsible for various design tasks</p></li>";

function makeData(): ResumeData {
	const data = structuredClone(defaultResumeData);
	data.sections.experience.items = [
		{
			id: "kettle",
			hidden: false,
			company: "Studio Kettle",
			position: "Junior Designer",
			location: "Lisbon",
			period: "2016 - 2019",
			website: { url: "", label: "", inlineLink: false },
			description: `<ul>${OLD_BULLET}<li><p>Designed websites &amp; identities for 20+ businesses</p></li></ul>`,
			roles: [],
		} as ResumeData["sections"]["experience"]["items"][number],
	];
	return data;
}

const proposal = (patch: Partial<Proposal> = {}): Proposal => ({
	id: "1",
	target: { sectionId: "experience", itemId: "kettle", field: "description" },
	location: "Experience · Studio Kettle · bullet 1",
	before: "<p>Responsible for various design tasks</p>",
	after: "<p>Produced packaging and print work for local retail clients</p>",
	why: "Names an outcome.",
	status: "pending",
	source: "check",
	...patch,
});

describe("proposals", () => {
	it("applies while the passage is still in the field, and only then", () => {
		const data = makeData();
		expect(canApply(data, proposal())).toBe(true);

		const next = produce(data, (draft) => {
			expect(applyProposal(draft, proposal())).toBe(true);
		});
		expect(readTarget(next, proposal().target)).toContain("<li><p>Produced packaging and print work");
		expect(getProposalState(next, proposal())).toBe("stale");

		produce(next, (draft) => {
			expect(applyProposal(draft, proposal())).toBe(false);
		});
	});

	it("keeps dollar signs in the new text literal", () => {
		const next = produce(makeData(), (draft) => {
			applyProposal(draft, proposal({ after: "<p>Cut costs by $& and $1</p>" }));
		});
		expect(readTarget(next, proposal().target)).toContain("<p>Cut costs by $& and $1</p>");
	});

	it("replaces a block's text and escapes it, keeping the tag", () => {
		expect(replaceBlockText('<p class="x">Old</p>', "  New <b>&  bold  ")).toBe(
			'<p class="x">New &lt;b&gt;&amp; bold</p>',
		);
	});

	it("adds a block after a passage, marking only the new one", () => {
		const before = "<li><p>Responsible for various design tasks</p></li>";
		const addition = proposal({
			before,
			after: `${before}<li><p>Introduced monthly accessibility reviews</p></li>`,
		});
		const data = makeData();
		expect(readTarget(markProposals(data, [addition]), addition.target)).toContain(
			`${before}<li><p><mark data-color="#d4efd9">Introduced monthly accessibility reviews</mark></p></li>`,
		);
		const next = produce(data, (draft) => {
			applyProposal(draft, addition);
		});
		expect(readTarget(next, addition.target)).toContain("Introduced monthly accessibility reviews</p></li><li>");
		expect(getProposalState(next, { ...addition, status: "accepted" })).toBe("accepted");
	});
});

it("toasts real applied and failed counts, skips locked writes, and keeps Undo from erasing later edits", () => {
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
	mocks.toast.mockClear();
	const state = {
		resume: { id: "resume", data: makeData(), isLocked: false },
		updateResumeData: vi.fn((recipe: (draft: ResumeData) => void) => {
			state.resume.data = produce(state.resume.data, recipe);
		}),
		undo: vi.fn(),
	};
	mocks.store.mockReturnValue(state);
	const rewrite = proposal();
	const addition = proposal({ id: "addition", after: "<p>Conflicting rewrite</p>" });
	expect(acceptResumeProposals([rewrite, addition])).toEqual({ applied: [rewrite], stale: [addition] });
	expect(mocks.toast).toHaveBeenLastCalledWith(
		expect.objectContaining({
			description: "Edit applied · 1 edit couldn't be placed: its text changed. Ask again to redo it.",
		}),
	);
	const undo = mocks.toast.mock.lastCall?.[0].actionProps.onClick;
	undo();
	expect(state.undo).toHaveBeenCalledOnce();
	state.undo.mockClear();
	state.resume.data = makeData();
	undo();
	expect(state.undo).not.toHaveBeenCalled();
	state.resume.isLocked = true;
	mocks.toast.mockClear();
	state.updateResumeData.mockClear();
	expect(acceptResumeProposals([rewrite, addition])).toEqual({ applied: [], stale: [] });
	expect(mocks.toast).not.toHaveBeenCalled();
	expect(state.updateResumeData).not.toHaveBeenCalled();
});
