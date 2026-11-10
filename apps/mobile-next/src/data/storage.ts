import SQLiteStorage from "expo-sqlite/kv-store";
const fixture = new Map<string, string>();
const isFixtureKey = (key: string) =>
	/^(queue:|query:|s7:|settings:|linked:|recurring:|searches:|first-run:|notification-completion:|job-copy:)storyboard(?:$|:)/.test(
		key,
	) || key.startsWith("reactive-resume:unsaved:storyboard:");
/** Storyboard accounts never write their fake content into the real account store. */
const Storage = {
	getItemSync: (key: string) => (isFixtureKey(key) ? (fixture.get(key) ?? null) : SQLiteStorage.getItemSync(key)),
	setItemSync(key: string, value: string) {
		if (isFixtureKey(key)) fixture.set(key, value);
		else SQLiteStorage.setItemSync(key, value);
	},
	removeItemSync(key: string) {
		return isFixtureKey(key) ? fixture.delete(key) : SQLiteStorage.removeItemSync(key);
	},
	getAllKeysSync: () => [...SQLiteStorage.getAllKeysSync(), ...fixture.keys()],
};
export function resetFixtureStorage() {
	fixture.clear();
}
export default Storage;
