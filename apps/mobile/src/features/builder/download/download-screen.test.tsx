import type { ResumeData } from "@reactive-resume/schema/resume/data";
import type { ReactNode } from "react";
import { act, fireEvent, render } from "@testing-library/react-native";
import { i18n } from "@lingui/core";
import { defaultResumeData } from "@reactive-resume/schema/resume/default";
import { DownloadScreen } from "./download-screen";

let mockDocument: { id: string; isLocked: boolean; data: ResumeData };
let mockLocked = false;
const mockUpdate = jest.fn();
const mockPrepare = jest.fn(async () => ({}));

jest.mock("expo-router", () => ({ useIsFocused: () => true, useLocalSearchParams: () => ({}) }));
jest.mock("@/dev/storyboard/harness", () => ({ STORYBOARD: false }));
jest.mock("../share/document", () => ({
	useDocumentId: () => "resume",
	useBuilderDocument: (id: string) => ({ data: id ? mockDocument : undefined, isPending: false, isError: false }),
	useLetterDocument: () => ({ data: undefined, isPending: false, isError: false }),
	DocumentState: () => null,
}));
jest.mock("./export-file", () => ({
	prepareExport: (...args: unknown[]) => mockPrepare(...(args as [])),
	deliverExport: async () => undefined,
	deliverExports: async () => undefined,
}));
jest.mock("@/data", () => {
	const draft = () => ({
		document: mockDocument,
		locked: mockLocked,
		update: mockUpdate,
		flush: async () => undefined,
	});
	return {
		useConnectivity: () => ({ offline: false }),
		useResume: () => ({ data: undefined }),
		useResumeStore: Object.assign(draft, { getState: () => ({ document: mockDocument, status: "saved" }) }),
		useLetterStore: Object.assign(() => ({}), { getState: () => ({}) }),
	};
});
jest.mock("@/ui", () => {
	const { Text, TextInput, View } = jest.requireActual<typeof import("react-native")>("react-native");
	const Pass = ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => (
		<View>
			{children}
			{footer}
		</View>
	);
	return {
		Button: ({ label, onPress }: { label: string; onPress: () => void }) => (
			<Text accessibilityRole="button" onPress={onPress}>
				{label}
			</Text>
		),
		TextField: ({ label, ...props }: { label: string }) => <TextInput accessibilityLabel={label} {...props} />,
		FooterBar: Pass,
		Form: Pass,
		SheetScreen: Pass,
		SheetScrollView: Pass,
		PushScreen: Pass,
		ListRow: () => null,
		Radio: () => null,
		Spinner: () => null,
		TextLink: () => null,
		Text,
		haptic: () => undefined,
		showToast: () => undefined,
	};
});

beforeEach(() => {
	jest.clearAllMocks();
	mockLocked = false;
	const data = structuredClone(defaultResumeData);
	data.basics.name = "Jordan Lee";
	mockDocument = { id: "resume", isLocked: false, data };
	i18n.loadAndActivate({ locale: "en-US", messages: {} });
});

test("a resume's typed file name is saved with its draft, and the field follows the draft after editing", async () => {
	const view = await render(<DownloadScreen />);
	const field = view.getByLabelText("File name");

	await fireEvent.changeText(field, "Jordan-Acme");
	expect(mockUpdate).toHaveBeenCalledTimes(1);
	await fireEvent(field, "blur");
	// The mocked draft didn't change, so the field shows the generated name again.
	expect(field.props.value).toBe("Jordan Lee Resume");
});

test("a locked resume keeps its typed file name for this export only", async () => {
	mockLocked = true;
	mockDocument.isLocked = true;
	const view = await render(<DownloadScreen />);
	const field = view.getByLabelText("File name");

	await fireEvent.changeText(field, "Jordan-Acme");
	await fireEvent(field, "blur");
	expect(mockUpdate).not.toHaveBeenCalled();
	expect(field.props.value).toBe("Jordan-Acme");

	await act(async () => {
		await fireEvent.press(view.getByText("Share"));
	});
	expect(mockPrepare).toHaveBeenCalledWith(mockDocument, "resume", "pdf", "Jordan-Acme");
});
