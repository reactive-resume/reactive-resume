jest.mock("@/auth/session", () => ({ getAccountScope: () => "alex" }));
import { createDocumentHistory } from "./history";
test("each edit is reversible, recording after undo drops future, clearing ends a document visit", () => {
	const history = createDocumentHistory();
	let value = "first";
	value = "second";
	history.record({
		undo: () => {
			value = "first";
		},
		redo: () => {
			value = "second";
		},
	});
	history.undo();
	expect(value).toBe("first");
	expect(history.canRedo).toBe(true);
	history.redo();
	expect(value).toBe("second");
	history.undo();
	history.record({ undo() {}, redo() {} });
	expect(history.canRedo).toBe(false);
	history.clear();
	expect(history.canUndo).toBe(false);
	expect(history.canRedo).toBe(false);
});
