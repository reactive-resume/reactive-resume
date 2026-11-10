// `.po` catalogs are compiled on import by @lingui/metro-transformer.
declare module "*.po" {
	import type { Messages } from "@lingui/core";

	export const messages: Messages;
}
