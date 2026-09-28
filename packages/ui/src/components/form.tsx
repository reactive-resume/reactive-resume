import { useRender } from "@base-ui/react";
import * as React from "react";
import { Label } from "@reactive-resume/ui/components/label";
import { cn } from "@reactive-resume/utils/style";

type FormItemContextValue = {
	id: string;
	hasError: boolean;
};

const FormItemContext = React.createContext<FormItemContextValue>({ id: "", hasError: false });

function useFormItem() {
	return React.use(FormItemContext);
}

type FormControlContextValue = {
	id?: string;
	labelId?: string;
	hasError?: boolean;
	"aria-describedby"?: string;
	"aria-invalid"?: boolean | "true" | "false";
};

const FormControlContext = React.createContext<FormControlContextValue | null>(null);

function useFormControl(): FormControlContextValue {
	return React.use(FormControlContext) ?? {};
}

type FormItemProps = React.ComponentProps<"div"> & { hasError?: boolean };

function FormItem({ className, hasError = false, ...props }: FormItemProps) {
	const id = React.useId();
	const contextValue = React.useMemo<FormItemContextValue>(() => ({ id, hasError }), [hasError, id]);

	return (
		<FormItemContext.Provider value={contextValue}>
			<div data-slot="form-item" className={cn("grid gap-1.5", className)} {...props} />
		</FormItemContext.Provider>
	);
}

function FormLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
	const { id, hasError } = useFormItem();

	return (
		<Label
			id={`${id}-form-item-label`}
			data-slot="form-label"
			data-error={hasError}
			className={cn("mb-0.5 data-[error=true]:text-destructive", className)}
			htmlFor={`${id}-form-item`}
			{...props}
		/>
	);
}

const LABELABLE_TAGS = new Set(["button", "input", "meter", "output", "progress", "select", "textarea"]);
const LABELABLE_ROLES = new Set([
	"button",
	"combobox",
	"gridcell",
	"listbox",
	"option",
	"progressbar",
	"radio",
	"searchbox",
	"slider",
	"spinbutton",
	"switch",
	"tab",
	"textbox",
	"treeitem",
]);

function isLabelableElement(element: Element) {
	if (LABELABLE_TAGS.has(element.tagName.toLowerCase())) return true;
	if (element.getAttribute("contenteditable") === "true") return true;
	const role = element.getAttribute("role");
	if (role && LABELABLE_ROLES.has(role)) return true;
	return false;
}

function useFormControlWarning(controlId: string) {
	React.useEffect(() => {
		if (process.env.NODE_ENV === "production") return;
		if (typeof document === "undefined") return;

		const element = document.getElementById(controlId);
		if (!element) {
			console.warn(
				`FormControl: no element in the document has the generated id "${controlId}". The <FormLabel for="${controlId}"> target is dangling.`,
			);
			return;
		}

		if (!isLabelableElement(element)) {
			console.warn(
				`FormControl: the element that carries the generated id "${controlId}" is not a labelable element. A <label for="${controlId}"> will not name the control.`,
			);
		}
	}, [controlId]);
}

function FormControl({ render, ...props }: useRender.ComponentProps<"div">) {
	const { id, hasError } = useFormItem();
	const controlId = `${id}-form-item`;
	const labelId = `${id}-form-item-label`;
	const describedBy = hasError ? `${id}-form-item-description ${id}-form-item-message` : `${id}-form-item-description`;

	const contextValue = React.useMemo<FormControlContextValue>(
		() => ({
			id: controlId,
			labelId,
			hasError,
			"aria-describedby": describedBy,
			"aria-invalid": hasError,
		}),
		[controlId, describedBy, hasError, labelId],
	);

	useFormControlWarning(controlId);

	const element = useRender({
		defaultTagName: "div",
		render,
		state: { slot: "form-control" },
		props: {
			id: controlId,
			"data-slot": "form-control",
			"aria-describedby": describedBy,
			"aria-invalid": hasError,
			...props,
		},
	});

	return <FormControlContext.Provider value={contextValue}>{element}</FormControlContext.Provider>;
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
	const { id } = useFormItem();

	return (
		<p
			data-slot="form-description"
			id={`${id}-form-item-description`}
			className={cn("text-muted-foreground text-xs leading-normal", className)}
			{...props}
		/>
	);
}

type FormMessageProps = Omit<React.ComponentProps<"p">, "children"> & {
	errors?: ReadonlyArray<unknown>;
};

function extractErrorMessage(errors: ReadonlyArray<unknown> | undefined): string | undefined {
	if (!errors || errors.length === 0) return undefined;

	for (const err of errors) {
		if (!err) continue;
		if (typeof err === "string") return err;
		if (typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
			return (err as { message: string }).message;
		}
	}

	return undefined;
}

function FormMessage({ className, errors, ...props }: FormMessageProps) {
	const { id, hasError } = useFormItem();
	const body = extractErrorMessage(errors);

	if (!body) return null;

	return (
		<p
			id={`${id}-form-item-message`}
			data-error={hasError}
			data-slot="form-message"
			className={cn(
				"line-clamp-1 starting:-translate-y-1 text-xs starting:opacity-0 transition-[opacity,translate] duration-150 ease-out-strong",
				hasError ? "text-destructive" : "text-muted-foreground",
				className,
			)}
			{...props}
		>
			{body}
		</p>
	);
}

export { FormControl, FormControlContext, FormDescription, FormItem, FormLabel, FormMessage, useFormControl };
