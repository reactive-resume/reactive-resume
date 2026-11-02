import type { NativeModule } from "expo";
import { requireOptionalNativeModule } from "expo";

/** Cmd/Ctrl plus `input` by default; `modifier: "none"` opts into bare keys (also `enter` and `?`). `title` names the action. */
export type KeyCommand = {
	id: string;
	input: string;
	shift?: boolean | undefined;
	title: string;
	modifier?: "none" | undefined;
};

declare class KeyCommandsModule extends NativeModule<{
	onKeyCommand: (event: { id: string }) => void;
}> {
	/** Replaces every registered command. */
	setCommands(commands: KeyCommand[]): void;
	/** Bare-key delivery and press/release handling require a new native binary. */
	readonly supportsUnmodifiedCommands?: boolean;
}

/** Null in dev clients built before this module existed: callers skip shortcuts instead of crashing. */
export const keyCommands = requireOptionalNativeModule<KeyCommandsModule>("KeyCommands");
