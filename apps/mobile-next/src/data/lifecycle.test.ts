const mockRead = jest.fn();
const mockUpdate = jest.fn(async (..._args: unknown[]) => ({}));
jest.mock("./client", () => ({
	dataClient: {
		applications: {
			getById: (...args: unknown[]) => mockRead(...args),
			update: (...args: unknown[]) => mockUpdate(...args),
		},
	},
}));
jest.mock("./scope", () => ({ activeDataScope: () => "account", assertDataScope: jest.fn() }));
import { reopenApplication } from "./lifecycle";

beforeEach(() => {
	mockRead.mockReset();
	mockUpdate.mockClear();
});
test("closed submitted application reopens at Applied without replacing sent documents", async () => {
	mockRead.mockResolvedValue({ status: "closed", sentResumeVersionId: "sent", activity: [] });
	await reopenApplication("application");
	expect(mockUpdate).toHaveBeenCalledWith(
		expect.objectContaining({ id: "application", status: "applied", closedReason: null }),
		{ context: { scope: "account" } },
	);
	expect(mockUpdate.mock.calls[0]?.[0]).not.toHaveProperty("resumeId");
});
test("closed unsent application defaults to Saved; explicit Applied still requires confirmation", async () => {
	mockRead.mockResolvedValue({ status: "closed", activity: [] });
	await reopenApplication("application");
	expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "saved" }), expect.anything());
	mockUpdate.mockClear();
	await expect(reopenApplication("application", "applied")).rejects.toThrow("Confirm");
	expect(mockUpdate).not.toHaveBeenCalled();
});
test("recorded submission without documents reopens at Applied; changed open job is not overwritten", async () => {
	mockRead
		.mockResolvedValueOnce({ status: "closed", activity: [{ type: "stage", stage: "applied" }] })
		.mockResolvedValueOnce({ status: "interview", activity: [] });
	await reopenApplication("application");
	expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "applied" }), expect.anything());
	await expect(reopenApplication("application")).rejects.toThrow("changed");
});
