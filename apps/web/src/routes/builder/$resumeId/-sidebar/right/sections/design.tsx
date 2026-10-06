import type { ReactNode } from "react";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useSelector } from "@tanstack/react-form";
import { AnimatePresence, m } from "motion/react";
import { colorDesignSchema, levelDesignSchema } from "@reactive-resume/schema/resume/data";
import { resolveLevelDisplaySizes } from "@reactive-resume/schema/resume/level-display-sizes";
import { FormControl, FormItem, FormLabel, FormMessage } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { Separator } from "@reactive-resume/ui/components/separator";
import { cn } from "@reactive-resume/utils/style";
import { SectionBase } from "../shared/section-base";
import { ColorPicker } from "@/components/input/color-picker";
import { IconPicker } from "@/components/input/icon-picker";
import { LevelTypeCombobox } from "@/components/level/combobox";
import { LevelDisplay } from "@/components/level/display";
import { useCurrentResume, useUpdateResumeData } from "@/features/resume/builder/draft";
import { useSyncFormValues } from "@/hooks/use-sync-form-values";
import { D1, EASE } from "@/libs/motion";
import { useAppForm } from "@/libs/tanstack-form";

export function DesignSectionBuilder() {
	return (
		<SectionBase type="design" className="space-y-6">
			<ColorSectionForm />
			<Separator />
			<LevelSectionForm />
		</SectionBase>
	);
}

type ColorValues = z.infer<typeof colorDesignSchema>;

function useColorSectionForm(colors: ColorValues, persist: (data: ColorValues) => void) {
	const form = useAppForm({
		defaultValues: colors,
		validators: { onChange: colorDesignSchema },
		listeners: {
			onChange: ({ formApi }) => {
				persist(formApi.state.values);
			},
		},
		onSubmit: ({ value }) => {
			persist(value);
		},
	});
	useSyncFormValues(form, colors);
	return form;
}

type ColorSectionForm = ReturnType<typeof useColorSectionForm>;

function ColorSectionForm() {
	const resume = useCurrentResume();
	const colors = resume.data.metadata.design.colors;
	const updateResumeData = useUpdateResumeData();

	const persist = (data: ColorValues) => {
		updateResumeData((draft) => {
			draft.metadata.design.colors = data;
		});
	};

	const form = useColorSectionForm(colors, persist);

	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="primary">
				{(field) => (
					<FormItem
						className="flex flex-wrap gap-2.5 p-1"
						hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}
					>
						{quickColorOptions.map((color) => (
							<QuickColorCircle
								key={color}
								color={color}
								active={color === field.state.value}
								onSelect={(color) => {
									field.handleChange(color as string);
								}}
							/>
						))}
					</FormItem>
				)}
			</form.Field>

			<ColorFormField form={form} name="primary" label={<Trans>Primary Color</Trans>} controlled />
			<ColorFormField form={form} name="text" label={<Trans>Text Color</Trans>} />
			<ColorFormField form={form} name="background" label={<Trans>Background Color</Trans>} />
		</form>
	);
}

type ColorFormFieldProps = {
	form: ColorSectionForm;
	name: keyof ColorValues;
	label: ReactNode;
	controlled?: boolean;
};

function ColorFormField({ form, name, label, controlled }: ColorFormFieldProps) {
	return (
		<form.Field name={name}>
			{(field) => (
				<FormItem hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
					<FormLabel>{label}</FormLabel>
					<div className="flex items-center gap-3">
						<ColorPicker
							{...(controlled ? { value: field.state.value } : { defaultValue: field.state.value })}
							onChange={(color) => {
								field.handleChange(color);
							}}
						/>
						<FormControl
							render={
								<Input
									name={field.name}
									value={field.state.value}
									onBlur={field.handleBlur}
									onChange={(e) => {
										field.handleChange(e.target.value);
									}}
								/>
							}
						/>
					</div>
					<FormMessage errors={field.state.meta.errors} />
				</FormItem>
			)}
		</form.Field>
	);
}

const quickColorOptions = [
	"rgba(231, 0, 11, 1)", // red-600
	"rgba(245, 73, 0, 1)", // orange-600
	"rgba(225, 113, 0, 1)", // amber-600
	"rgba(208, 135, 0, 1)", // yellow-600
	"rgba(94, 165, 0, 1)", // lime-600
	"rgba(0, 166, 62, 1)", // green-600
	"rgba(0, 153, 102, 1)", // emerald-600
	"rgba(0, 150, 137, 1)", // teal-600
	"rgba(0, 146, 184, 1)", // cyan-600
	"rgba(0, 132, 209, 1)", // sky-600
	"rgba(21, 93, 252, 1)", // blue-600
	"rgba(79, 57, 246, 1)", // indigo-600
	"rgba(127, 34, 254, 1)", // violet-600
	"rgba(152, 16, 250, 1)", // purple-600
	"rgba(200, 0, 222, 1)", // fuchsia-600
	"rgba(230, 0, 118, 1)", // pink-600
	"rgba(236, 0, 63, 1)", // rose-600
	"rgba(69, 85, 108, 1)", // slate-600
	"rgba(74, 85, 101, 1)", // gray-600
	"rgba(82, 82, 92, 1)", // zinc-600
	"rgba(82, 82, 82, 1)", // neutral-600
	"rgba(87, 83, 77, 1)", // stone-600
];

type QuickColorCircleProps = React.ComponentProps<"button"> & {
	color: string;
	active: boolean;
	onSelect: (color: string) => void;
};

function QuickColorCircle({ color, active, onSelect, className, ...props }: QuickColorCircleProps) {
	return (
		<button
			type="button"
			aria-label={t`Use color ${color}`}
			onClick={() => onSelect(color)}
			className={cn(
				"relative flex size-8 items-center justify-center rounded-md bg-transparent",
				"transition-[scale,background-color] duration-quick ease-enter hover:bg-sunken/80 active:scale-[0.97]",
				className,
			)}
			{...props}
		>
			<div style={{ backgroundColor: color }} className="size-6 shrink-0 rounded-md" />

			<AnimatePresence initial={false}>
				{active && (
					<m.div
						initial={{ scale: 0.95, opacity: 0 }}
						animate={{ scale: 1, opacity: 1 }}
						exit={{ scale: 0.95, opacity: 0 }}
						transition={{ duration: D1, ease: EASE }}
						className="absolute inset-0 flex size-8 items-center justify-center"
					>
						<div className="size-4 rounded-md bg-ink" />
					</m.div>
				)}
			</AnimatePresence>
		</button>
	);
}

type LevelValues = z.infer<typeof levelDesignSchema>;
type LevelType = LevelValues["type"];

function LevelSectionForm() {
	const resume = useCurrentResume();
	const colors = resume.data.metadata.design.colors;
	const levelDesign = resume.data.metadata.design.level;
	const updateResumeData = useUpdateResumeData();

	const persist = (data: LevelValues) => {
		updateResumeData((draft) => {
			draft.metadata.design.level = data;
		});
	};

	const form = useAppForm({
		defaultValues: levelDesign,
		validators: { onChange: levelDesignSchema },
		listeners: {
			onChange: ({ formApi }) => {
				persist(formApi.state.values);
			},
		},
		onSubmit: ({ value }) => {
			persist(value);
		},
	});
	useSyncFormValues(form, levelDesign);

	const previewType = useSelector(form.store, (s) => s.values.type);
	const previewIcon = useSelector(form.store, (s) => s.values.icon);
	const { decorationSize, levelIconExplicitSize } = resolveLevelDisplaySizes({
		bodyFontSize: resume.data.metadata.typography.body.fontSize,
	});

	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<h4 className="text-lg leading-none font-semibold tracking-tight">
				<Trans>Level</Trans>
			</h4>

			<div
				style={{ "--page-primary-color": colors.primary, backgroundColor: colors.background } as React.CSSProperties}
				className="flex items-center justify-center rounded-md p-6"
			>
				<LevelDisplay
					level={3}
					type={previewType}
					icon={previewIcon}
					decorationSizePx={decorationSize}
					iconSizePx={levelIconExplicitSize}
					className="w-full max-w-[220px] justify-center"
				/>
			</div>

			<div className="flex items-center gap-3">
				<form.Field name="icon">
					{(field) => (
						<FormItem className="shrink-0" hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>Icon</Trans>
							</FormLabel>
							<FormControl
								render={
									<IconPicker
										size="icon"
										value={field.state.value}
										onChange={(value) => {
											field.handleChange(value);
										}}
									/>
								}
							/>
						</FormItem>
					)}
				</form.Field>

				<form.Field name="type">
					{(field) => (
						<FormItem className="flex-1" hasError={field.state.meta.isTouched && field.state.meta.errors.length > 0}>
							<FormLabel>
								<Trans>Type</Trans>
							</FormLabel>
							<FormControl
								render={
									<LevelTypeCombobox
										value={field.state.value}
										onValueChange={(value) => {
											if (!value) return;
											field.handleChange(value as LevelType);
										}}
									/>
								}
							/>
						</FormItem>
					)}
				</form.Field>
			</div>
		</form>
	);
}
