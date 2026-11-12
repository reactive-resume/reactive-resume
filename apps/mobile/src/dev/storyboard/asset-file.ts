// A bundled storyboard asset as a file the app can read. An Android release build embeds images as drawables, and
// expo-asset hands back the bare resource name; the legacy copy reads a resource by that name into the cache.
import { Asset } from "expo-asset";
import { File, Paths } from "expo-file-system";
import { copyAsync } from "expo-file-system/legacy";

export async function assetFile(module: number): Promise<string> {
	const asset = await Asset.fromModule(module).downloadAsync();
	const uri = asset.localUri ?? asset.uri;
	if (uri.includes(":")) return uri;
	const file = new File(Paths.cache, `${uri}.${asset.type || "png"}`);
	if (!file.exists) await copyAsync({ from: uri, to: file.uri });
	return file.uri;
}
