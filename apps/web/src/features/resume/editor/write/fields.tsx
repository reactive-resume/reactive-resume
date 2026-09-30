import type { Website } from "@reactive-resume/schema/resume/data";
import type { ComponentProps, ReactNode } from "react";
import type { Entry } from "./model";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useCallback, useState } from "react";
import { Checkbox } from "@reactive-resume/ui/components/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@reactive-resume/ui/components/collapsible";
import { FormControl, FormDescription, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { cn } from "@reactive-resume/utils/style";
import { URLInput } from "@/components/input/url-input";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";
import { findEntry } from "./model";

/** One entry of a section, re-rendering only when that entry changes; null once it's deleted. */
export const useEntry = (sectionId: string, entryId: string) =>
	useCurrentBuilderResumeSelector((resume) => findEntry(resume.data, sectionId, entryId) ?? null);

export type EntryWriter = (key: string, mutate: (entry: Record<string, unknown>) => void) => void;

/**
 * Writes one field of an entry. The key names the field, so typing in one field folds into one undo step
 * while a different field starts a new one.
 */
export function useEntryWriter(sectionId: string, entryId: string): EntryWriter {
	const updateResumeData = useUpdateResumeData();

	return useCallback(
		(key, mutate) => {
			updateResumeData(
				(draft) => {
					const entry = findEntry(draft, sectionId, entryId);
					if (entry) mutate(entry as Entry & Record<string, unknown>);
				},
				{ coalesceKey: `${entryId}:${key}` },
			);
		},
		[updateResumeData, sectionId, entryId],
	);
}

type Validator = (value: string) => string | undefined;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Says how to fix an email address rather than only that it's wrong. */
export const validateEmail: Validator = (value) => {
	const email = value.trim();
	if (!email || EMAIL.test(email)) return undefined;
	const [name, domain] = email.split("@");
	if (!name || domain === undefined) return t`Add an @ and the domain, like name@example.com`;
	if (!domain) return t`Add the domain after the @, like ${name}@example.com`;
	return t`Add the domain ending, like ${domain}.com`;
};

/** Accepts web addresses with or without https://, as the page links them either way. */
const validateUrl: Validator = (value) => {
	const url = value.trim();
	if (!url) return undefined;
	try {
		const parsed = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
		if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname.includes(".")) throw new Error();
		return undefined;
	} catch {
		return t`Enter a web address, like example.com`;
	}
};

type TextFieldProps = Omit<ComponentProps<typeof Input>, "value" | "onChange"> & {
	label: ReactNode;
	value: string;
	onChange: (value: string) => void;
	/** Checked after the field is first left, then as you type. */
	validate?: Validator;
	hint?: ReactNode;
	wide?: boolean | undefined;
};

/** A labelled text field. Errors appear after the first blur and say how to fix them. */
export function TextField({
	label,
	value,
	onChange,
	validate,
	hint,
	wide,
	className,
	onBlur,
	...props
}: TextFieldProps) {
	const [touched, setTouched] = useState(false);
	const error = touched ? validate?.(value) : undefined;

	return (
		<FormItem hasError={Boolean(error)} className={cn(wide && "col-span-full")}>
			<FormLabel>{label}</FormLabel>
			<FormControl
				render={
					<Input
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onBlur={(event) => {
							setTouched(true);
							onBlur?.(event);
						}}
						className={className}
						{...props}
					/>
				}
			/>
			<FormMessage errors={error ? [error] : []} />
			{hint && !error && <FormDescription>{hint}</FormDescription>}
		</FormItem>
	);
}

type WebsiteFieldProps = {
	label?: ReactNode;
	value: Website & { inlineLink?: boolean };
	onChange: (value: Website & { inlineLink?: boolean }) => void;
	/** Entries can print the link on their title instead of on its own line. */
	allowInlineLink?: boolean;
};

export function WebsiteField({ label, value, onChange, allowInlineLink = true }: WebsiteFieldProps) {
	const [touched, setTouched] = useState(false);
	const error = touched ? validateUrl(value.url) : undefined;
	const inline = value.inlineLink ?? false;

	return (
		<div className="col-span-full grid gap-2">
			<FormItem hasError={Boolean(error)}>
				<FormLabel>{label ?? <Trans>Link</Trans>}</FormLabel>
				<FormControl
					render={
						<URLInput value={value} onChange={onChange} hideLabelButton={inline} onBlur={() => setTouched(true)} />
					}
				/>
				<FormMessage errors={error ? [error] : []} />
			</FormItem>

			{allowInlineLink && (
				// biome-ignore lint/a11y/noLabelWithoutControl: Base UI's Checkbox is the control; wrapping it in a label is its documented pattern.
				<label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
					<Checkbox checked={inline} onCheckedChange={(checked) => onChange({ ...value, inlineLink: checked })} />
					<Trans>Show link in title</Trans>
				</label>
			)}
		</div>
	);
}

type MoreOptionsProps = { children: ReactNode };

/** Secondary fields (level, icon, colour) stay out of the way until asked for. */
export function MoreOptions({ children }: MoreOptionsProps) {
	return (
		<Collapsible className="col-span-full">
			<CollapsibleTrigger className="group/more flex w-fit cursor-pointer items-center gap-1 rounded-sm font-medium text-[13px] text-ink-2 transition-colors duration-quick hover:text-ink">
				<span
					aria-hidden="true"
					className="transition-transform duration-standard ease-enter group-data-panel-open/more:rotate-90"
				>
					›
				</span>
				<Trans>More options</Trans>
			</CollapsibleTrigger>
			<CollapsibleContent hiddenUntilFound>
				<div className="grid gap-y-2.5 pt-3">{children}</div>
			</CollapsibleContent>
		</Collapsible>
	);
}
