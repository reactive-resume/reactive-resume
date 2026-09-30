import type { VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cva } from "class-variance-authority";
import { Button } from "@reactive-resume/ui/components/button";
import { useFormControl } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";

function InputGroup({
	className,
	id: idProp,
	"aria-describedby": ariaDescribedByProp,
	"aria-invalid": ariaInvalidProp,
	...props
}: React.ComponentProps<"fieldset">) {
	const formControl = useFormControl();
	// Inside a FormControl composition the generated control props belong to
	// the inner input (delivered via context), not the fieldset wrapper.
	// Standalone usage has no FormControl, so explicit native fieldset props
	// must survive untouched.
	const insideFormControl = formControl.id !== undefined;
	const fieldsetId = insideFormControl ? undefined : idProp;
	const fieldsetDescribedBy = insideFormControl ? undefined : ariaDescribedByProp;
	const fieldsetInvalid = insideFormControl ? undefined : ariaInvalidProp;

	return (
		<fieldset
			data-slot="input-group"
			id={fieldsetId}
			aria-describedby={fieldsetDescribedBy}
			aria-invalid={fieldsetInvalid}
			className={cn(
				"group/input-group relative flex h-9 w-full min-w-0 items-center rounded-md border border-line-2 bg-raised text-ink transition-[border-color,box-shadow] duration-quick outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:shadow-none has-disabled:bg-sunken has-disabled:text-ink-3 has-[[data-slot=input-group-control]:focus]:border-accent has-[[data-slot=input-group-control]:focus]:shadow-[0_0_0_3px_var(--accent-soft)] has-[[data-slot][aria-invalid=true]]:border-danger has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto pointer-coarse:h-11 has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pe-1.5 has-[>[data-align=inline-start]]:[&>input]:ps-1.5",
				className,
			)}
			{...props}
		/>
	);
}

const inputGroupAddonVariants = cva(
	"flex h-auto cursor-text items-center justify-center gap-2 py-1.5 text-sm text-ink-3 select-none group-data-[disabled=true]/input-group:opacity-50 [&>svg:not([class*='size-'])]:size-4",
	{
		variants: {
			align: {
				"inline-start": "order-first ps-2 has-[>button]:ms-[-0.3rem] has-[>kbd]:ms-[-0.15rem]",
				"inline-end": "order-last pe-2 has-[>button]:me-[-0.3rem] has-[>kbd]:me-[-0.15rem]",
				"block-start":
					"order-first w-full justify-start px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
				"block-end": "order-last w-full justify-start px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
			},
		},
		defaultVariants: {
			align: "inline-start",
		},
	},
);

function InputGroupAddon({
	className,
	align = "inline-start",
	...props
}: React.ComponentProps<"fieldset"> & VariantProps<typeof inputGroupAddonVariants>) {
	return (
		<fieldset
			data-align={align}
			data-slot="input-group-addon"
			className={cn(inputGroupAddonVariants({ align }), className)}
			onKeyDown={(e) => {
				if (!(e.target instanceof Element) || !e.currentTarget.contains(e.target)) return;
				if (e.key !== " " && e.key !== "Enter") return;
				if (!(e.target as HTMLElement).closest("button")) {
					e.preventDefault();
					e.currentTarget.parentElement?.querySelector("input")?.focus();
				}
			}}
			onClick={(e) => {
				if (!(e.target instanceof Element) || !e.currentTarget.contains(e.target)) return;
				if (!(e.target as HTMLElement).closest("button")) {
					e.preventDefault();
					e.currentTarget.parentElement?.querySelector("input")?.focus();
				}
			}}
			{...props}
		/>
	);
}

const inputGroupButtonVariants = cva("flex items-center gap-2 text-sm shadow-none", {
	variants: {
		size: {
			xs: "h-6 gap-1 rounded-sm px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
			sm: "",
			"icon-xs": "size-6 rounded-sm p-0 has-[>svg]:p-0",
			"icon-sm": "size-8 p-0 has-[>svg]:p-0",
		},
	},
	defaultVariants: {
		size: "xs",
	},
});

function InputGroupButton({
	className,
	type = "button",
	variant = "ghost",
	size = "xs",
	...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
	VariantProps<typeof inputGroupButtonVariants> & {
		type?: "button" | "submit" | "reset";
	}) {
	return (
		<Button
			type={type}
			data-size={size}
			variant={variant}
			className={cn(inputGroupButtonVariants({ size }), className)}
			{...props}
		/>
	);
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"flex items-center gap-2 text-sm text-ink-3 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
				className,
			)}
			{...props}
		/>
	);
}

function InputGroupInput({
	className,
	id: idProp,
	"aria-describedby": ariaDescribedByProp,
	"aria-invalid": ariaInvalidProp,
	...props
}: React.ComponentProps<"input">) {
	const formControl = useFormControl();
	const controlId = idProp ?? formControl.id;
	const describedBy = ariaDescribedByProp ?? formControl["aria-describedby"];
	const invalid = ariaInvalidProp ?? formControl["aria-invalid"];

	return (
		<Input
			data-slot="input-group-control"
			id={controlId}
			aria-describedby={describedBy}
			aria-invalid={invalid}
			className={cn(
				"h-full flex-1 rounded-none border-0 bg-transparent shadow-none focus:shadow-none disabled:bg-transparent aria-invalid:focus:shadow-none",
				className,
			)}
			{...props}
		/>
	);
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText };
