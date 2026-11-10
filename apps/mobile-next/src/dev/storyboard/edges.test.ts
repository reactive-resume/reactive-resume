import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { router, Slot } from "expo-router";
import { act, fireEvent, renderRouter, screen } from "expo-router/testing-library";
import * as Sharing from "expo-sharing";
import React from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { StoryboardInsets, STORYBOARD_NOW } from "./harness";
import { storyboardRoutes } from "./routes";
import { scenarios } from "./scenarios";
import { DataProvider, seed, useResumeStore } from "@/data";
import { setNow } from "@/data/clock";
import { fakeBackend } from "@/data/fixtures";
import { pageRenderer } from "@/render/page-renderer";

jest.mock("@/dev/storyboard/harness", () => {
	process.env.EXPO_PUBLIC_STORYBOARD = "1";
	return jest.requireActual("./harness");
});
jest.mock("@/ui/Hero", () => ({
	...jest.requireActual("@/ui/Hero"),
	prepareHero: jest.fn(async () => false),
	flyBack: jest.fn(async () => false),
}));
jest.mock("expo-sharing", () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock("expo-audio", () => ({
	RecordingPresets: { HIGH_QUALITY: {} },
	useAudioRecorder: () => ({ prepareToRecordAsync: jest.fn(), record: jest.fn(), stop: jest.fn() }),
	useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
}));
jest.mock("expo-network", () => ({
	useNetworkState: () => ({ isConnected: true, isInternetReachable: true }),
	getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }),
	addNetworkStateListener: () => ({ remove: () => {} }),
}));
jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: { getItemSync: () => null, setItemSync: jest.fn(), removeItemSync: jest.fn(), getAllKeysSync: () => [] },
}));
jest.mock("@/api/client", () => {
	const procedure = (): unknown =>
		new Proxy(
			() => {
				throw new Error("Unexpected real API call");
			},
			{ get: (_t, key) => (key === "then" ? undefined : procedure()) },
		);
	return { client: procedure(), streamClient: procedure() };
});
jest.mock("react-native-gesture-handler", () => {
	const actual = jest.requireActual("react-native-gesture-handler");
	return { ...actual, GestureDetector: ({ children }: { children: React.ReactNode }) => children };
});
jest.unmock("react-native-reanimated");
require("react-native-reanimated").setUpTests();

const repoRoot = path.resolve(__dirname, "../../../../..");
const appDir = path.join(repoRoot, "apps/mobile-next/app");
/**
 * The app's route files as the bundler sees them: Metro's route context skips `+native-intent`, the testing
 * library's file scan doesn't. Modules load on first use, as with a real require context.
 */
function appRoutes(overrides: Record<string, unknown>) {
	const routes: Record<string, unknown> = {};
	for (const file of readdirSync(appDir, { recursive: true }) as string[]) {
		if (!/\.[jt]sx?$/.test(file) || /(^|\/)\+native-intent\./.test(file)) continue;
		const key = file.replace(/\.[jt]sx?$/, "");
		if (key in overrides) continue;
		Object.defineProperty(routes, key, { enumerable: true, get: () => require(path.join(appDir, file)) });
	}
	return Object.assign(routes, overrides);
}
const root = path.resolve(
	repoRoot,
	execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: repoRoot, encoding: "utf8" }).trim(),
	"../apps/mobile-next",
);
const bundle = path.resolve(root, "../../.agents/handoff/mobile-final/design/layout");
type Element = { n: number; depth: number; text?: string; label?: string; navigatesTo?: string; component?: string };
const edges = readdirSync(bundle)
	.filter((f) => f.endsWith(".json"))
	.sort()
	.flatMap((file) => {
		const layout = JSON.parse(readFileSync(path.join(bundle, file), "utf8")) as { id: string; elements?: Element[] };
		return (layout.elements ?? []).flatMap((edge, i, elements) => {
			if (!edge.navigatesTo) return [];
			const texts: string[] = [];
			for (const child of elements.slice(i + 1)) {
				if (child.depth <= edge.depth) break;
				if (child.text) texts.push(child.text);
			}
			return [
				{
					source: layout.id,
					...edge,
					target: edge.navigatesTo,
					texts,
					underlay: edge.n < (elements.find((e) => e.component === "BottomSheet" || e.component === "Dialog")?.n ?? 0),
				},
			];
		});
	});
// Captures use pixel-only stubs under overlays. Exercise their real route owners here.
const backgrounds: Record<string, string> = {
	"D2-Actions": "/documents",
	"D3-New": "/documents",
	"B14-Download": "/builder/resume-product/share",
	"B19-More": "/builder/resume-product",
	"B21-EntryActions": "/builder/resume-product/section/experience",
	"J7-Stage": "/applications/lumen",
	"J8-Interview": "/applications/lumen",
	"J9-Close": "/applications/parcel",
	"C7-Schedule": "/career",
	"S7-FirstSend": "/import?review=1",
	"S8-SignOut": "/settings?queued=offline",
};
test("layout bundle contains all 257 navigation edges", () => expect(edges).toHaveLength(257));
const screensSpec = readFileSync(path.resolve(bundle, "../../SCREENS.md"), "utf8");
const buildSpec = readFileSync(path.resolve(bundle, "../../BUILD.md"), "utf8");
// Each discrepancy still activates its control and asserts its documented destination/state.
const specFlows: Record<string, { pathname: string; quote: string; visible?: string }> = {
	"B6-Design #8": { pathname: "/builder/[id]/menu", quote: "··· opens the document menu (B19).", visible: "Rename…" },
	"B9-Check #8": { pathname: "/builder/[id]/menu", quote: "··· opens the document menu (B19).", visible: "Rename…" },
	"B10-JobMatch #8": {
		pathname: "/builder/[id]/menu",
		quote: "··· opens the document menu (B19).",
		visible: "Rename…",
	},
	"B11-Share #8": { pathname: "/builder/[id]/menu", quote: "··· opens the document menu (B19).", visible: "Rename…" },
	"C1-Career #21": {
		pathname: "/career/knowledge/stories",
		quote: "Stories list (from C1) is the same row pattern",
		visible: "Building the shared system",
	},
	"C4-Story #3": {
		pathname: "/career/knowledge/stories",
		quote: "Stories list (from C1) is the same row pattern",
		visible: "Building the shared system",
	},
	"D1-Library #36": { pathname: "/builder/[id]", quote: "Tap → the editor (B1 or L1)." },
	"D2-Actions #29": { pathname: "/builder/[id]", quote: "Tap → the editor (B1 or L1)." },
	"D3-New #29": { pathname: "/builder/[id]", quote: "Tap → the editor (B1 or L1)." },
	"D1-Library #73": {
		pathname: "/documents",
		quote: "Select → checkboxes on the rows and a bottom bar",
		visible: "Done",
	},
	"D2-Actions #70": {
		pathname: "/documents/[id]/actions",
		quote: "Share PDF renders the PDF, then opens the system share sheet.",
	},
	"D3-New #62": {
		pathname: "/new",
		quote: "Cover letter asks which application if more than one is open",
		visible: "Which application?",
	},
	"J2-Board #49": { pathname: "/applications", quote: "The view choice is remembered.", visible: "Board" },
	"J3-Calendar #75": { pathname: "/applications", quote: "The view choice is remembered.", visible: "Calendar" },
	"J6-Detail #47": {
		pathname: "/applications/[id]/debrief",
		quote: "Debrief and Library use the W5 layout",
		visible: "What happened?",
	},
	"J6-Detail #61": {
		pathname: "/applications/[id]/library",
		quote: "Debrief and Library use the W5 layout",
		visible: "Library",
	},
	"L1-Letter #40": {
		pathname: "/letter/[id]/export",
		quote: "Export is a screen with B14's formats",
		visible: "Letter only",
	},
	"L2-LetterDesign #40": {
		pathname: "/letter/[id]/export",
		quote: "Export is a screen with B14's formats",
		visible: "Letter only",
	},
};
const routeOf = (id: string) => {
	const route = storyboardRoutes[id];
	if (!route) throw new Error(`Missing route mapping ${id}`);
	return route;
};
const routePattern = (pathname: string) => new RegExp(`^${pathname.replace(/\[[^\]]+\]/g, "[^/]+")}/?$`);
afterEach(() => {
	jest.restoreAllMocks();
	jest.useRealTimers();
});
afterAll(() => {
	console.info(
		`Storyboard edges: ${edges.length} runtime cases; ${Object.keys(specFlows).length} dump/spec-text discrepancies.`,
	);
	console.info(
		`Occluded backdrop controls: ${edges
			.filter((edge) => edge.underlay)
			.map((edge) => `${edge.source} #${edge.n}`)
			.join(", ")}`,
	);
	for (const [edge, flow] of Object.entries(specFlows)) console.info(`${edge}: ${flow.pathname}; ${flow.quote}`);
});
function Root() {
	return React.createElement(
		StoryboardInsets,
		null,
		React.createElement(
			KeyboardProvider,
			null,
			React.createElement(
				I18nProvider,
				{ i18n },
				React.createElement(DataProvider, { backend: "fake" }, React.createElement(Slot)),
			),
		),
	);
}

test.each(edges)("$source #$n → $target", async (edge) => {
	const key = `${edge.source} #${edge.n}`;
	const flow = specFlows[key];
	if (flow) expect(screensSpec + buildSpec).toContain(flow.quote);
	const scenario = scenarios[edge.source];
	if (!scenario) throw new Error(`Missing scenario ${edge.source}`);
	if (scenario.fixture && scenario.fixture !== "storyboard" && scenario.fixture !== "empty-account")
		throw new Error(`Unknown fixture ${scenario.fixture}`);
	seed(scenario.fixture === "empty-account" ? "empty-account" : "storyboard");
	setNow(STORYBOARD_NOW);
	if (key === "D2-Actions #70") {
		jest.spyOn(pageRenderer, "render").mockResolvedValue({
			pdfFile: "file:///storyboard.pdf",
			pages: [],
			pageCount: 1,
			revision: "test",
			stale: false,
		});
		jest.mocked(Sharing.shareAsync).mockClear();
	}
	const first = scenario.hrefs[0] === "/applications" ? "/applications?view=list" : scenario.hrefs[0];
	const primeView = edge.target === "J1-List" && !first?.startsWith("/applications");
	const view = await renderRouter(appRoutes({ _layout: Root }) as never, {
		initialUrl: primeView ? "/applications?view=list" : first,
	});
	await act(() => jest.advanceTimersByTimeAsync(100));
	if (primeView) {
		await act(() => router.replace(first as never));
		await act(() => jest.advanceTimersByTimeAsync(100));
	}
	for (const captureHref of scenario.hrefs.slice(1)) {
		const href = captureHref.startsWith("/storyboard-backdrop/")
			? backgrounds[edge.source]
			: captureHref === "/applications"
				? "/applications?view=list"
				: captureHref;
		if (!href) throw new Error(`Missing real backdrop ${edge.source}`);
		if (edge.source === "S7-FirstSend" && href.startsWith("/import")) await act(() => router.push("/documents"));
		if (view.getPathname() === href) continue;
		await act(() => router.push(href as never));
		await act(() => jest.advanceTimersByTimeAsync(100));
	}
	const prepare = scenario.prepare;
	if (prepare) {
		const href = scenario.hrefs.find((h) => h.startsWith("/builder/"));
		const id = href?.split("/")[2];
		if (id) await act(() => useResumeStore.getState().open(id));
		await act(async () => {
			const prepared = prepare();
			await jest.advanceTimersByTimeAsync(100);
			await prepared;
		});
	}
	await act(() => jest.advanceTimersByTimeAsync(100));
	expect(view.getPathname()).toMatch(routePattern(routeOf(edge.source)));
	if (edge.source === "S8-SignOut") {
		await fireEvent(screen.getByTestId("settings-sign-out"), "accessibilityTap");
		expect(screen.getByText("Keep working")).toBeTruthy();
		await fireEvent(screen.getByText("Keep working"), "accessibilityTap");
		await act(() => jest.advanceTimersByTimeAsync(500));
	}
	if (edge.source === "C6-Offers") {
		await fireEvent(screen.getByText(/"Better for you" follows/), "textLayout", {
			nativeEvent: { lines: [{ x: 0, y: 0, width: 100, height: 20 }] },
		});
	}
	if (edge.underlay && edge.source !== "S8-SignOut") {
		// A scrim blocks these drawn anchors. Dismiss first, then exercise the real underlying control.
		await fireEvent(screen.getByLabelText("Close"), "accessibilityTap");
		await act(() => jest.advanceTimersByTimeAsync(500));
	}
	const aliases = edge.label?.startsWith("Back to ")
		? ["Back"]
		: edge.label?.startsWith("Close ")
			? ["Close"]
			: edge.label === "Back"
				? ["Back to documents"]
				: [];
	const candidates = [edge.label, edge.text, ...edge.texts, ...aliases].filter((s): s is string => !!s);
	const controls = candidates.flatMap((label) => {
		const byLabel = screen.queryAllByLabelText(label);
		return byLabel.length ? byLabel : screen.queryAllByText(label);
	});
	if (!controls.length) throw new Error(`Control missing: ${candidates.join(" | ")}`);
	const nestedAction = edge.texts.includes("Add a fact") ? screen.getAllByLabelText("Add a fact")[0] : undefined;
	const direct = nestedAction ?? controls.find((node) => typeof node.props.onAccessibilityTap === "function");
	let control = direct ?? controls[0];
	if (!control) throw new Error(`Control missing: ${key}`);
	while (typeof control.props.onAccessibilityTap !== "function" && control.parent) control = control.parent;
	expect(typeof control.props.onAccessibilityTap).toBe("function");
	expect(control.props.accessibilityState?.disabled).not.toBe(true);
	if (!(edge.underlay && routePattern(routeOf(edge.target)).test(view.getPathname()))) {
		await fireEvent(control, "accessibilityTap");
	}
	await act(() => jest.advanceTimersByTimeAsync(500));
	const expected = flow?.pathname ?? routeOf(edge.target);
	expect(view.getPathname()).toMatch(routePattern(expected));
	if (flow?.visible) expect(screen.getAllByText(flow.visible).length).toBeGreaterThan(0);
	if (key === "D1-Library #73") {
		await fireEvent(screen.getByLabelText("Product designer"), "accessibilityTap");
		for (const label of ["Tags", "Move to Trash", "Download"])
			expect(screen.getAllByText(label).length).toBeGreaterThan(0);
	}
	if (key === "D2-Actions #70") {
		expect(pageRenderer.render).toHaveBeenCalledWith(expect.objectContaining({ kind: "resume", id: "resume-lead" }));
		expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///storyboard.pdf", {
			mimeType: "application/pdf",
			UTI: "com.adobe.pdf",
		});
	}
	if (key === "D3-New #62") {
		await fireEvent(screen.getByLabelText("Lumen"), "accessibilityTap");
		await act(() => jest.advanceTimersByTimeAsync(500));
		expect(view.getPathname()).toMatch(routePattern(routeOf(edge.target)));
	}
	if (/^J[123]-/.test(edge.target)) {
		const label =
			key === "J2-Board #49"
				? "Board"
				: key === "J3-Calendar #75"
					? "Calendar"
					: { "J1-List": "List", "J2-Board": "Board", "J3-Calendar": "Calendar" }[edge.target];
		if (!label) throw new Error(`Missing application view ${edge.target}`);
		expect(screen.getByRole("tab", { name: label, selected: true })).toBeTruthy();
	}
	if (key === "W3-Prep #24") {
		expect(screen.getByText("New story")).toBeTruthy();
		const before = await fakeBackend.read("stories", {});
		await fireEvent(screen.getByLabelText("Save"), "accessibilityTap");
		expect(view.getPathname()).toBe("/career/knowledge/stories/new");
		expect(await fakeBackend.read("stories", {})).toEqual(before);
		for (const [label, value] of [
			["Title", "Accessibility decision"],
			["Situation", "Audit"],
			["Task", "Improve access"],
			["What I did", "Tested with users"],
		] as const)
			await fireEvent.changeText(screen.getByLabelText(label), value);
		await fireEvent(screen.getByLabelText("Save"), "accessibilityTap");
		await act(() => jest.advanceTimersByTimeAsync(500));
		expect(view.getPathname()).not.toBe("/career/knowledge/stories/new");
		expect((await fakeBackend.read("stories", {})).some((row) => row.data.title === "Accessibility decision")).toBe(
			true,
		);
	}
	if (edge.source === "B9-Check" && edge.target === "B10-JobMatch")
		expect(screen.getByRole("tab", { name: "Job match", selected: true })).toBeTruthy();
	if (edge.source === "B10-JobMatch" && edge.target === "B9-Check")
		expect(screen.getByRole("tab", { name: "Issues", selected: true })).toBeTruthy();
	if (edge.source === "J9-Close" && edge.target === "J7-Stage")
		expect(screen.getByText("Move Parcel & Co.")).toBeTruthy();
});
