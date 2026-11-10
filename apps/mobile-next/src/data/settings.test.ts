jest.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryFn }: { queryFn: () => unknown }) => ({ data: queryFn(), refetch: async () => queryFn() }),
}));
jest.mock("./provider", () => ({ useDataBackend: () => ({ scope: "storyboard" }) }));
jest.mock("./platform", () => ({}));
jest.mock("./application-tools", () => ({}));
jest.mock("./local-state", () => ({}));
jest.mock("./client", () => ({}));
jest.mock("./connectivity", () => ({}));
jest.mock("./today", () => ({}));
jest.mock("./trash", () => ({}));
jest.mock("./scope", () => ({ assertDataScope: jest.fn() }));
jest.mock("expo-sqlite/kv-store", () => ({ __esModule: true, default: {} }));
import { setTimeZone } from "./clock";
import { useSettings } from "./collections";
import Storage, { resetFixtureStorage } from "./storage";

beforeEach(() => {
	resetFixtureStorage();
	setTimeZone("Europe/Berlin");
});
afterEach(() => setTimeZone());
test("home timezone survives restart/travel independently of last notification and remembered application view", async () => {
	expect(useSettings().data).toMatchObject({
		homeTimeZone: "Europe/Berlin",
		automaticTimeZone: true,
		lastNotifiedTimeZone: null,
	});
	setTimeZone("America/New_York");
	const travelled = useSettings();
	expect(travelled.data).toMatchObject({ homeTimeZone: "Europe/Berlin", lastNotifiedTimeZone: null });
	await travelled.save({ lastNotifiedTimeZone: "America/New_York", applicationView: "calendar" });
	expect(useSettings().data).toMatchObject({
		homeTimeZone: "Europe/Berlin",
		lastNotifiedTimeZone: "America/New_York",
		applicationView: "calendar",
	});
});
test("old timezone preference migrates to home and independent saves preserve newer sibling changes", async () => {
	Storage.setItemSync("settings:storyboard", JSON.stringify({ lastTimeZone: "Europe/Lisbon" }));
	const pane = useSettings();
	expect(pane.data).toMatchObject({ homeTimeZone: "Europe/Lisbon" });
	await useSettings().save({ applicationView: "board" });
	await pane.save({ haptics: false });
	expect(useSettings().data).toMatchObject({ applicationView: "board", haptics: false });
});
