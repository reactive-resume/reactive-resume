import type { Application } from "./model";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
const mockToast = jest.fn();
const mockInvalidate = jest.fn();
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("./actions", () => ({ useApplicationActions: jest.fn() }));
jest.mock("@/data", () => ({}));
jest.mock("./posting-file", () => ({
	PostingPdfError: class PostingPdfError extends Error {},
	pickPostingPdf: jest.fn(),
	attachPostingPdf: jest.fn(),
	removePostingPdf: jest.fn(),
	openPostingPdf: jest.fn(),
}));
jest.mock("@/ui", () => {
	const { View, Text, Pressable } = require("react-native");
	return {
		layout: { screenMargin: 24 },
		BottomSheet: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
		Icon: () => null,
		ListRow: ({ title, onPress }: { title: string; onPress: () => void }) => (
			<Pressable onPress={onPress}>
				<Text>{title}</Text>
			</Pressable>
		),
		showToast: (value: unknown) => mockToast(value),
	};
});
import { PostingSheet } from "./detail-sheets";
import { pickPostingPdf, PostingPdfError } from "./posting-file";

beforeEach(() => {
	jest.clearAllMocks();
});
test.each([false, true])(
	"shows translated operation failures and preserves validation messages (classified: %s)",
	async (classified) => {
		const error = classified ? new PostingPdfError("Choose a PDF file.") : new Error("Private file unavailable.");
		jest.mocked(pickPostingPdf).mockRejectedValue(error);
		const { getByText } = await render(<PostingSheet app={{ id: "application" } as Application} onClose={jest.fn()} />);
		await fireEvent.press(getByText("Attach the posting PDF"));
		await waitFor(() =>
			expect(mockToast).toHaveBeenCalledWith({
				message: classified ? "Choose a PDF file." : "Couldn't attach the posting PDF. Try again.",
			}),
		);
	},
);
