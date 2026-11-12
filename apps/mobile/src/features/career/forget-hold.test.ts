import { createForgetHold } from "./forget-hold";

test("Forget stays local and both Undo and Show forgotten can restore before leaving", async () => {
	const commit = jest.fn(async () => undefined);
	const hold = createForgetHold<{ id: string; text: string }>(commit);
	hold.hold({ id: "a", text: "original words" });
	expect(commit).not.toHaveBeenCalled();
	expect(hold.values()[0]?.text).toBe("original words");
	hold.restore("a");
	await hold.flush();
	expect(commit).not.toHaveBeenCalled();
	hold.hold({ id: "b", text: "forget this" });
	await hold.flush();
	expect(commit).toHaveBeenCalledWith({ id: "b", text: "forget this" });
	expect(hold.values()).toEqual([]);
	await hold.flush();
	expect(commit).toHaveBeenCalledTimes(1);
});

test("failed finalization keeps the fact for retry", async () => {
	const commit = jest.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
	const hold = createForgetHold<{ id: string }>(commit);
	hold.hold({ id: "a" });
	await expect(hold.flush()).rejects.toThrow("offline");
	expect(hold.values()).toEqual([{ id: "a" }]);
	await hold.flush();
	expect(hold.values()).toEqual([]);
});
