import { OTPField as OTPFieldPrimitive } from "@base-ui/react/otp-field";
import { cn } from "@reactive-resume/utils/style";

function OTPField({ className, length, children, ...props }: OTPFieldPrimitive.Root.Props) {
	return (
		<OTPFieldPrimitive.Root
			data-slot="otp-field"
			length={length}
			className={cn("group flex items-center gap-1.5", className)}
			{...props}
		>
			{children ?? Array.from({ length }, (_, index) => <OTPFieldInput key={index} />)}
		</OTPFieldPrimitive.Root>
	);
}

function OTPFieldInput({ className, ...props }: OTPFieldPrimitive.Input.Props) {
	return (
		<OTPFieldPrimitive.Input
			data-slot="otp-field-input"
			className={cn(
				"size-9 rounded-lg border border-input bg-transparent text-center font-mono text-sm outline-none transition-[color,background-color,border-color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 group-aria-invalid:border-destructive group-aria-invalid:ring-3 group-aria-invalid:ring-destructive/20",
				className,
			)}
			{...props}
		/>
	);
}

export { OTPField, OTPFieldInput };
