// Expo's defaults handle the pnpm monorepo. The addition compiles Lingui `.po`
// catalogs on import.
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.transformer.babelTransformerPath = require.resolve("@lingui/metro-transformer/expo");
config.resolver.sourceExts.push("po");

module.exports = config;
