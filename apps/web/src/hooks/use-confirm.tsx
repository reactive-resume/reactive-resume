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
	variant?: "primary" | "danger";
	cancelText?: string;
	/** Prompts only: the text the field starts with. */
	defaultValue?: string;
	/** An aborted request dismisses its pending confirmation. */
	signal?: AbortSignal;
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

let requestConfirm: Ask | null = null;

/** Non-React request code uses the same accessible confirmation dialog as task controls. */
export async function confirmOperation(title: string, options: AskOptions) {
	return requestConfirm ? (await requestConfirm(title, options, false)) !== null : false;
}

const AskContext = React.createContext<Ask | null>(null);

/** One dialog answers both `useConfirm` and `usePrompt`: a question, and a text field when it's a prompt. */
export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
	const [state, setState] = React.useState<AskState>({ open: false, title: "", withInput: false, resolve: null });
	const [value, setValue] = React.useState("");

	const pending = React.useRef<((value: string | null) => void) | null>(null);
	const ask: Ask = (title, options, withInput) =>
		new Promise((resolve) => {
			pending.current?.(null);
			const finish = (value: string | null) => {
				options?.signal?.removeEventListener("abort", cancel);
				if (pending.current === finish) pending.current = null;
				resolve(value);
			};
			const cancel = () => {
				finish(null);
				setState((previous) => (previous.resolve === finish ? { ...previous, open: false, resolve: null } : previous));
			};
			if (options?.signal?.aborted) {
				resolve(null);
				return;
			}
			pending.current = finish;
			options?.signal?.addEventListener("abort", cancel, { once: true });
			setValue(options?.defaultValue ?? "");
			setState({ ...options, open: true, title, withInput, resolve: finish });
		});

	React.useEffect(() => {
		requestConfirm = ask;
		return () => {
			requestConfirm = null;
		};
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
							<AlertDialogAction variant={state.variant} onClick={() => answer(state.withInput ? value : "")}>
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
