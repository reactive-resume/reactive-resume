// Hermes cannot compile some syntax emitted by dependencies:
// - destructured rest parameters (oRPC), lowered by transform-parameters;
// - the `v` (unicodeSets) regex flag (@sindresorhus/slugify, transliterate), rewritten to `u` by transform-unicode-sets-regex.
module.exports = (api) => {
	api.cache(true);
	return {
		presets: ["babel-preset-expo"],
		plugins: [
			"@babel/plugin-transform-parameters",
			"@babel/plugin-transform-unicode-sets-regex",
			"@lingui/babel-plugin-lingui-macro",
		],
	};
};
