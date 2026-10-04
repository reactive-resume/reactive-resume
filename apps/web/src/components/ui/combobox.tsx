import type { ComboboxTriggerState } from "@base-ui/react/combobox";
import type { UseRenderRenderProp } from "@base-ui/react/use-render";
import { t } from "@lingui/core/macro";
import React from "react";
import { Button } from "@reactive-resume/ui/components/button";
import {
	ComboboxClear,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
	ComboboxRoot,
	ComboboxTrigger,
	ComboboxValue,
	useFilter,
} from "@reactive-resume/ui/components/combobox";
import { Input } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";
import { useControlledState } from "@/hooks/use-controlled-state";

type ComboboxOption<TValue extends string | number = string> = {
	value: TValue;
	label: React.ReactNode;
	// Plain-text label used for the collapsed trigger and filtering when `label` is a ReactNode.
	// Without it, a JSX label falls back to String(value) (e.g. a raw enum or locale code) in the trigger.
	textValue?: string;
	keywords?: string[];
	disabled?: boolean;
};

type SingleComboboxProps<TValue extends string | number = string> = {
	options: ComboboxOption<TValue>[];
	value?: TValue | null | undefined;
	defaultValue?: TValue | null | undefined;
	onValueChange?: (value: TValue | null) => void;
	multiple?: false;
	disabled?: boolean;
	showClear?: boolean;
	placeholder?: string;
	emptyMessage?: React.ReactNode;
	className?: string;
	id?: string;
	name?: string;
	render?: UseRenderRenderProp<ComboboxTriggerState>;
};

type MultiComboboxProps<TValue extends string | number = string> = {
	options: ComboboxOption<TValue>[];
	value?: TValue[] | null | undefined;
	defaultValue?: TValue[] | null | undefined;
	onValueChange?: (value: TValue[] | null) => void;
	multiple: true;
	disabled?: boolean;
	showClear?: boolean;
	placeholder?: string;
	emptyMessage?: React.ReactNode;
	className?: string;
	id?: string;
	name?: string;
	render?: UseRenderRenderProp<ComboboxTriggerState>;
};

type ComboboxProps<TValue extends string | number = string> = SingleComboboxProps<TValue> | MultiComboboxProps<TValue>;

const listContent = <TValue extends string | number>(item: ComboboxOption<TValue>) => (
	<ComboboxItem key={String(item.value)} value={item} disabled={item.disabled}>
		{item.label}
	</ComboboxItem>
);

function Combobox<TValue extends string | number = string>(props: ComboboxProps<TValue>) {
	const {
		options,
		multiple = false,
		disabled = false,
		showClear = false,
		placeholder,
		emptyMessage,
		className,
		id,
		name,
		render,
	} = props;

	const { contains } = useFilter();

	const optionMap = React.useMemo(() => new Map(options.map((opt) => [String(opt.value), opt])), [options]);

	const findOption = React.useCallback(
		(v: TValue | TValue[] | null | undefined) => {
			if (multiple) {
				if (!v || !Array.isArray(v)) return [];
				return (v as TValue[]).flatMap((item) => {
					const option = optionMap.get(String(item));
					return option ? [option] : [];
				});
			}
			if (v == null) return null;
			return optionMap.get(String(v)) ?? null;
		},
		[optionMap, multiple],
	);

	type OptionValue = ComboboxOption<TValue>[] | ComboboxOption<TValue> | null;

	const resolvedValue = React.useMemo(
		() => (props.value !== undefined ? (findOption(props.value) as OptionValue) : undefined),
		[props.value, findOption],
	);

	const resolvedDefaultValue = React.useMemo(
		() => (props.defaultValue !== undefined ? (findOption(props.defaultValue) as OptionValue) : undefined),
		[props.defaultValue, findOption],
	);

	const handleExternalChange = React.useCallback(
		(option: ComboboxOption<TValue>[] | ComboboxOption<TValue> | null) => {
			if (multiple) {
				const arrOpt = Array.isArray(option) ? option : option ? [option] : [];
				(props as MultiComboboxProps<TValue>).onValueChange?.(arrOpt.length > 0 ? arrOpt.map((opt) => opt.value) : []);
			} else {
				const value = option && !Array.isArray(option) ? (option as ComboboxOption<TValue>).value : null;
				const cb = props.onValueChange as ((value: TValue | null) => void) | undefined;
				cb?.(value ?? null);
			}
		},
		[props, multiple],
	);

	const [selectedValue, setSelectedValue] = useControlledState({
		value: resolvedValue,
		defaultValue: resolvedDefaultValue,
		onChange: handleExternalChange,
	});

	const itemToStringLabel = React.useCallback(
		(item: ComboboxOption<TValue>) =>
			item.textValue ?? (typeof item.label === "string" ? item.label : String(item.value)),
		[],
	);

	const isItemEqualToValue = React.useCallback(
		(a: ComboboxOption<TValue>, b: ComboboxOption<TValue>) => String(a.value) === String(b.value),
		[],
	);

	const filter = React.useCallback(
		(item: ComboboxOption<TValue>, query: string) => {
			const labelStr = typeof item.label === "string" ? item.label : (item.textValue ?? String(item.value));
			if (contains(labelStr, query)) return true;
			return item.keywords?.some((kw) => contains(kw, query)) ?? false;
		},
		[contains],
	);

	const hasSelectedValue = multiple
		? Array.isArray(selectedValue) && selectedValue.length > 0
		: selectedValue !== null && selectedValue !== undefined;

	const triggerNode = (
		<ComboboxTrigger
			id={id}
			disabled={disabled}
			render={
				render ?? (
					<Button
						variant="secondary"
						className={cn("justify-start text-left font-normal hover:bg-sunken/20", className)}
					/>
				)
			}
		>
			<span className={cn("min-w-0 flex-1 truncate text-left", showClear && hasSelectedValue && "pe-7")}>
				<ComboboxValue placeholder={placeholder ?? t`Select...`} />
			</span>
		</ComboboxTrigger>
	);

	return (
		<ComboboxRoot
			name={name}
			items={options}
			filter={filter}
			disabled={disabled}
			value={selectedValue as ComboboxOption<TValue>[] & ComboboxOption<TValue>}
			onValueChange={setSelectedValue as (value: ComboboxOption<TValue>[] | ComboboxOption<TValue> | null) => void}
			itemToStringLabel={itemToStringLabel}
			isItemEqualToValue={isItemEqualToValue}
			{...(multiple ? { multiple: true } : {})}
		>
			{showClear ? (
				<div className="relative w-full min-w-0">
					{triggerNode}
					{hasSelectedValue && (
						<ComboboxClear
							aria-label={t`Clear selection`}
							disabled={disabled}
							className="absolute end-7 top-1/2 z-10 -translate-y-1/2 text-ink-3 opacity-70 hover:opacity-100 focus-visible:opacity-100"
						/>
					)}
				</div>
			) : (
				triggerNode
			)}

			<ComboboxContent aria-label={placeholder ?? t`Options`}>
				<ComboboxInput
					placeholder={placeholder ?? t`Search...`}
					render={<Input disabled={disabled} className="border-none focus-visible:border-none focus-visible:ring-0" />}
				/>
				<ComboboxEmpty>{emptyMessage ?? t`No results found.`}</ComboboxEmpty>
				<ComboboxList>{listContent}</ComboboxList>
			</ComboboxContent>
		</ComboboxRoot>
	);
}

export { Combobox, type ComboboxOption, type MultiComboboxProps, type SingleComboboxProps };
