import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { i18n } from "@lingui/core";
import { sampleResumeData } from "@reactive-resume/schema/resume/sample";
import { SectionScreen } from "./SectionScreen";

let mockData: ResumeData;
let mockLocked = false;
const mockOpen = jest.fn<void, [unknown, { label: string; onPress: () => void }[]]>();
const mockToast = jest.fn();

jest.mock("expo-router", () => ({ useRouter: () => ({}), useLocalSearchParams: () => ({}) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock("../shared/document", () => ({
	BuilderScreen: ({ children, barEnd }: { children: ReactNode; barEnd: ReactNode }) => (
		<>
			{barEnd}
			{children}
		</>
	),
	editResume: (recipe: (draft: ResumeData) => void) => recipe(mockData),
	useBuilderParams: () => ({ id: "resume", section: "publications" }),
	useLocked: () => mockLocked,
	useResumeData: () => mockData,
	useBackToResume: () => "Back",
}));
jest.mock("../shared/anchored-menu", () => ({
	Anchor: ({ children }: { children: ReactNode }) => children,
	useAnchorRef: () => ({}),
	useAnchoredMenu: () => ({ open: mockOpen }),
}));
jest.mock("../shared/section-actions", () => ({
	sectionActions: () => ({ rename: {}, up: {}, down: {}, hide: {} }),
	useRenameSection: () => ({}),
}));
jest.mock("../shared/entries", () => ({}));
jest.mock("@/data", () => ({ useResumeStore: { getState: () => ({}) } }));
jest.mock("@/dev/storyboard/harness", () => ({ STORYBOARD: false }));
jest.mock("@/ui", () => {
	const { Text, Pressable } = jest.requireActual<typeof import("react-native")>("react-native");
	return {
		IconButton: ({ label, onPress }: { label: string; onPress: () => void }) => (
			<Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} />
		),
		Text,
		TextLink: () => null,
		ReorderList: () => null,
		showToast: (...args: unknown[]) => mockToast(...args),
		useTheme: () => ({ colors: { line: "black" } }),
	};
});

beforeEach(() => {
	jest.clearAllMocks();
	mockLocked = false;
	mockData = structuredClone(sampleResumeData);
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

test("sorts using the resume locale and writes the warning in the interface locale", async () => {
	mockData.metadata.page.locale = "fr-FR";
	const [first] = mockData.sections.publications.items;
	if (!first) throw new Error("Missing sample publication");
	mockData.sections.publications.items = [
		{ ...first, id: "a", title: "Paper A", date: "", dates: undefined },
		{ ...first, id: "dated", date: "mars 2025", dates: undefined },
		{ ...first, id: "b", title: "Paper B", date: "Forthcoming", dates: undefined },
	];
	const view = await render(<SectionScreen />);
	await fireEvent.press(view.getByRole("button", { name: "Section options" }));
	const action = mockOpen.mock.calls[0]?.[1].find(({ label }) => label === "Sort by date");
	if (!action) throw new Error("Missing sort action");

	await act(() => action.onPress());

	expect(mockData.sections.publications.items.map(({ id }) => id)).toEqual(["dated", "a", "b"]);
	expect(mockToast).toHaveBeenCalledWith({
		message: "Couldn't read the dates on Paper A and Paper B, so they stay at the end. Fix their dates and sort again.",
	});
});

test("hides section actions when the resume is locked", async () => {
	mockLocked = true;
	const view = await render(<SectionScreen />);
	expect(view.queryByRole("button", { name: "Section options" })).toBeNull();
});

test.each([0, 1])("omits date sorting with %i entries", async (count) => {
	mockData.sections.publications.items = mockData.sections.publications.items.slice(0, count);
	const view = await render(<SectionScreen />);
	await fireEvent.press(view.getByRole("button", { name: "Section options" }));
	expect(mockOpen.mock.calls[0]?.[1].some(({ label }) => label === "Sort by date")).toBe(false);
});
