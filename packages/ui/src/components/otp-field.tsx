import { OTPField as OTPFieldPrimitive } from "@base-ui/react/otp-field";
import { cn } from "@reactive-resume/utils/style";

type OTPFieldProps = OTPFieldPrimitive.Root.Props & {
	/** Each box's accessible name, e.g. "Digit 2 of 6"; pass a translated string. */
	digitLabel?: (position: number, length: number) => string;
};

function OTPField({ className, length, children, digitLabel, ...props }: OTPFieldProps) {
	return (
		<OTPFieldPrimitive.Root
			data-slot="otp-field"
			length={length}
			className={cn("group flex items-center gap-1.5", className)}
			{...props}
		>
			{children ??
				Array.from({ length }, (_, index) => (
					<OTPFieldInput key={index} {...(digitLabel ? { "aria-label": digitLabel(index + 1, length) } : {})} />
				))}
		</OTPFieldPrimitive.Root>
	);
}

function OTPFieldInput({ className, ...props }: OTPFieldPrimitive.Input.Props) {
	return (
		<OTPFieldPrimitive.Input
			data-slot="otp-field-input"
			className={cn(
				"size-9 rounded-lg border border-control-border bg-transparent text-center font-mono text-sm transition-[color,background-color,border-color,box-shadow] outline-none group-aria-invalid:border-danger group-aria-invalid:ring-3 group-aria-invalid:ring-danger/20 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:bg-line-2/50 disabled:opacity-50 max-sm:size-11",
				className,
			)}
			{...props}
		/>
	);
}

export { OTPField, OTPFieldInput };
