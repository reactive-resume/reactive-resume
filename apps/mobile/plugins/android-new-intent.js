// React Native drops a link that reaches a running activity before its React context exists (ReactHostImpl.onNewIntent),
// and Linking.getInitialURL reads the activity's first intent. Keeping the newest intent lets the router read that link
// when it starts, so a link opened while the app is still launching lands instead of showing Today.
const { withMainActivity } = require("expo/config-plugins");

module.exports = (config) =>
	withMainActivity(config, (mod) => {
		let src = mod.modResults.contents;
		if (src.includes("setIntent(intent)")) return mod;
		if (!src.includes("import android.content.Intent")) {
			src = src.replace("import android.os.Bundle", "import android.content.Intent\nimport android.os.Bundle");
		}
		src = src.replace(
			/\n}\s*$/,
			"\n\n  override fun onNewIntent(intent: Intent) {\n    setIntent(intent)\n    super.onNewIntent(intent)\n  }\n}\n",
		);
		mod.modResults.contents = src;
		return mod;
	});
