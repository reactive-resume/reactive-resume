import { t } from "@lingui/core/macro";
import * as React from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@reactive-resume/ui/components/alert-dialog";
import { HoldButton } from "@reactive-resume/ui/components/hold-button";
import { Input } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";
import { isImeComposing } from "@/libs/keyboard";

type AskOptions = {
	description?: string;
	confirmText?: string;
	cancelText?: string;
	/** Prompts only: the text the field starts with. */
	defaultValue?: string;
	/** Confirmations only: the confirm button must be held, for actions that can't be undone. */
	hold?: boolean;
};

type AskState = AskOptions & {
	open: boolean;
	title: string;
	/** A prompt asks for text; a confirmation only for yes or no. */
	withInput: boolean;
	resolve: ((value: string | null) => void) | null;
};

type Ask = (title: string, options: AskOptions | undefined, withInput: boolean) => Promise<string | null>;

const AskContext = React.createContext<Ask | null>(null);

/** One dialog answers both `useConfirm` and `usePrompt`: a question, and a text field when it's a prompt. */
export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
	const [state, setState] = React.useState<AskState>({ open: false, title: "", withInput: false, resolve: null });
	const [value, setValue] = React.useState("");

	const ask: Ask = (title, options, withInput) =>
		new Promise((resolve) => {
			setValue(options?.defaultValue ?? "");
			setState({ ...options, open: true, title, withInput, resolve });
		});

	// Cancelling answers null; confirming answers the text (empty for a confirmation). The state stays while closing.
	const answer = (result: string | null) => {
		state.resolve?.(result);
		setState((previous) => ({ ...previous, open: false, resolve: null }));
	};

	return (
		<AskContext.Provider value={ask}>
			{children}

			<AlertDialog open={state.open} onOpenChange={(open) => !open && answer(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{state.title}</AlertDialogTitle>
						<AlertDialogDescription className={cn(!state.description && "sr-only")}>
							{state.description}
						</AlertDialogDescription>
					</AlertDialogHeader>

					{state.withInput && (
						<Input
							value={value}
							aria-label={state.title}
							onChange={(event) => setValue(event.target.value)}
							onKeyDown={(event) => {
								if (isImeComposing(event)) return;
								if (event.key === "Enter") answer(value);
							}}
						/>
					)}

					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => answer(null)}>{state.cancelText ?? t`Cancel`}</AlertDialogCancel>
						{state.hold ? (
							<HoldButton variant="danger" onConfirm={() => answer("")}>
								{state.confirmText}
							</HoldButton>
						) : (
							<AlertDialogAction onClick={() => answer(state.withInput ? value : "")}>
								{state.confirmText ?? t`Confirm`}
							</AlertDialogAction>
						)}
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</AskContext.Provider>
	);
}

function useAsk() {
	const ask = React.use(AskContext);
	if (!ask) throw new Error("useConfirm and usePrompt must be used within a <ConfirmDialogProvider />.");
	return ask;
}

/** Resolves true when the user confirms. */
export function useConfirm() {
	const ask = useAsk();
	return async (title: string, options?: Omit<AskOptions, "defaultValue">) =>
		(await ask(title, options, false)) !== null;
}

/** Resolves with the text entered, or null when the user cancels. */
export function usePrompt() {
	const ask = useAsk();
	return (title: string, options?: Omit<AskOptions, "hold">) => ask(title, options, true);
}
