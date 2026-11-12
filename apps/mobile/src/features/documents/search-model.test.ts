import { searchGroup } from "./search-model";
test("search groups preserve matches and reveal all only after expansion", () => {
	const values = ["resume", "letter", "job", "note", "conversation"];
	expect(searchGroup(values, false)).toEqual({ visible: values.slice(0, 3), remaining: 2 });
	expect(searchGroup(values, true)).toEqual({ visible: values, remaining: 0 });
	expect(searchGroup([], false)).toEqual({ visible: [], remaining: 0 });
	expect(searchGroup(["one"], false)).toEqual({ visible: ["one"], remaining: 0 });
});
