import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Slot } from "expo-router";
import { renderRouter } from "expo-router/testing-library";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { TrashScreen } from "./trash";

let mockEmpty = false;
jest.mock("react-native-safe-area-context", () => ({
	...jest.requireActual("react-native-safe-area-context"),
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/dev/storyboard/harness", () => ({
	useDesignTag: () => null,
	DesignScreen: ({ children }: { children: React.ReactNode }) => children,
	DesignClip: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/dev/storyboard/capture", () => ({ registerMainScroll: jest.fn() }));
jest.mock("@/auth/session", () => ({ getAccountScope: () => "test" }));
jest.mock("@/data", () => ({
	useDataBackend: () => ({ scope: "test" }),
	useToday: () => ({ now: new Date("2026-11-07T12:00:00Z") }),
	timeZone: () => "UTC",
	useTrash: () => ({
		snapshot: {
			isSuccess: true,
			isPending: false,
			isError: false,
			data: {
				resumes: [],
				letters: [],
				applications: mockEmpty
					? []
					: [
							{
								id: "job",
								company: "Example",
								role: "Designer",
								trashedAt: new Date("2026-11-01T00:00:00Z"),
								expiresAt: new Date("2026-12-31T00:00:00Z"),
							},
						],
			},
		},
	}),
}));

function Root() {
	return (
		<I18nProvider i18n={i18n}>
			<QueryClientProvider client={new QueryClient()}>
				<KeyboardProvider>
					<Slot />
				</KeyboardProvider>
			</QueryClientProvider>
		</I18nProvider>
	);
}

test.each([false, true])(
	"Trash explains timed removal when empty=%s and uses the server's removal date",
	async (empty) => {
		mockEmpty = empty;
		const view = await renderRouter({ _layout: Root, index: TrashScreen });
		expect(view.getByText("Documents and applications stay here for 30 days, then are deleted for good.")).toBeTruthy();
		if (empty)
			expect(
				view.getByText("Documents and applications you move here stay for 30 days, then are deleted for good."),
			).toBeTruthy();
		else expect(view.getByText("Removal date: Dec 31, 2026")).toBeTruthy();
	},
);
