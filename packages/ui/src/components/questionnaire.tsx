import type * as React from "react";
import type { Button } from "./button";
import { CheckIcon } from "@phosphor-icons/react";
import { Questionnaire as QuestionnairePrimitive } from "@shadcn/react/questionnaire";
import { cn } from "@reactive-resume/utils/style";
import { buttonVariants } from "./button";

function Questionnaire({ className, ...props }: React.ComponentProps<typeof QuestionnairePrimitive.Root>) {
	return (
		<QuestionnairePrimitive.Root
			data-slot="questionnaire"
			className={cn("flex w-full min-w-0 flex-col gap-4", className)}
			{...props}
		/>
	);
}

function QuestionnaireItem({ className, ...props }: React.ComponentProps<typeof QuestionnairePrimitive.Item>) {
	return (
		<QuestionnairePrimitive.Item
			data-slot="questionnaire-item"
			className={cn("flex min-w-0 flex-col gap-4 border-0 p-0 outline-none", className)}
			{...props}
		/>
	);
}

function QuestionnaireTitle({ className, ...props }: React.ComponentProps<typeof QuestionnairePrimitive.Title>) {
	return (
		<QuestionnairePrimitive.Title
			data-slot="questionnaire-title"
			className={cn(
				"cn-font-heading text-pretty font-medium text-base leading-snug [&:not(:has(~[data-slot=questionnaire-description]))]:mb-4",
				className,
			)}
			{...props}
		/>
	);
}

function QuestionnaireChoices({ className, ...props }: React.ComponentProps<typeof QuestionnairePrimitive.Choices>) {
	return (
		<QuestionnairePrimitive.Choices
			data-slot="questionnaire-choices"
			className={cn("group/questionnaire-choices grid min-w-0 gap-2", className)}
			{...props}
		/>
	);
}

function QuestionnaireChoice({
	children,
	className,
	...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
	return (
		<QuestionnairePrimitive.Choice
			data-slot="questionnaire-choice"
			className={cn(
				"group/questionnaire-choice relative flex min-h-11 cursor-pointer select-none items-start gap-2.5 rounded-lg border border-input bg-transparent px-3 py-2.5 text-start text-sm outline-none transition-colors hover:bg-muted/50 has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-3 has-[>input:focus-visible]:ring-ring/50 data-checked:border-primary/40 data-invalid:border-destructive data-checked:bg-muted dark:bg-input/20 dark:data-checked:bg-muted",
				"data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
				className,
			)}
			{...props}
		>
			<QuestionnairePrimitive.ChoiceInput
				data-slot="questionnaire-choice-input"
				className="absolute inset-0 z-10 size-full cursor-pointer opacity-0"
			/>
			<span
				aria-hidden="true"
				data-slot="questionnaire-choice-indicator"
				className="pointer-events-none relative flex size-4 shrink-0 translate-y-[--spacing(0.45)] items-center justify-center rounded-[4px] border border-input group-has-data-[slot=questionnaire-choice-description]/questionnaire-choice:translate-y-0.5 group-data-[type=radio]/questionnaire-choice:rounded-full group-data-checked/questionnaire-choice:border-primary group-data-checked/questionnaire-choice:bg-primary group-data-checked/questionnaire-choice:text-primary-foreground dark:bg-input/30 dark:group-data-checked/questionnaire-choice:bg-primary"
			>
				<span
					data-slot="questionnaire-choice-indicator-dot"
					className="hidden size-2 rounded-full bg-primary-foreground group-data-checked/questionnaire-choice:block group-data-[type=checkbox]/questionnaire-choice:hidden"
				/>
				<CheckIcon
					data-slot="questionnaire-choice-indicator-check"
					className="hidden size-3.5 group-data-checked/questionnaire-choice:block group-data-[type=radio]/questionnaire-choice:hidden"
				/>
			</span>
			<QuestionnairePrimitive.ChoiceLabel
				data-slot="questionnaire-choice-label"
				className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug"
			>
				{children}
			</QuestionnairePrimitive.ChoiceLabel>
			<QuestionnairePrimitive.ChoiceShortcut
				data-slot="questionnaire-choice-shortcut"
				className="pointer-events-none ms-auto hidden size-5 shrink-0 translate-y-[--spacing(0.45)] items-center justify-center rounded-md border border-input bg-background font-medium font-mono text-[0.625rem] text-muted-foreground leading-none group-has-data-[slot=questionnaire-choice-description]/questionnaire-choice:translate-y-0.5 group-data-[shortcut]/questionnaire-choice:inline-flex"
			/>
		</QuestionnairePrimitive.Choice>
	);
}

function QuestionnaireInput({ className, ...props }: React.ComponentProps<typeof QuestionnairePrimitive.Input>) {
	return (
		<div data-slot="questionnaire-input-wrapper" className="group/questionnaire-input relative w-full min-w-0">
			<QuestionnairePrimitive.Input
				data-slot="questionnaire-input"
				className={cn(
					"h-9 min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base outline-none transition-[color,box-shadow,background-color] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 sm:min-h-0 md:text-sm dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:disabled:bg-input/80",
					"selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground",
					className,
				)}
				{...props}
			/>
		</div>
	);
}

function QuestionnaireError({ className, ...props }: React.ComponentProps<typeof QuestionnairePrimitive.Error>) {
	return (
		<QuestionnairePrimitive.Error
			data-slot="questionnaire-error"
			className={cn("mt-2 text-destructive text-sm", className)}
			{...props}
		/>
	);
}

function QuestionnaireActions({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="questionnaire-actions"
			className={cn(
				"grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:min-h-8",
				className,
			)}
			{...props}
		/>
	);
}

function QuestionnaireSubmit({
	children,
	className,
	size = "default",
	variant = "default",
	...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Submit> &
	Pick<React.ComponentProps<typeof Button>, "size" | "variant">) {
	return (
		<QuestionnairePrimitive.Submit
			data-slot="questionnaire-submit"
			data-size={size}
			data-variant={variant}
			className={cn(
				buttonVariants({ size, variant }),
				"col-start-3 row-start-1 min-h-11 justify-self-end sm:min-h-0",
				className,
			)}
			{...props}
		>
			{children ?? "Submit"}
		</QuestionnairePrimitive.Submit>
	);
}

export {
	Questionnaire,
	QuestionnaireActions,
	QuestionnaireChoice,
	QuestionnaireChoices,
	QuestionnaireError,
	QuestionnaireInput,
	QuestionnaireItem,
	QuestionnaireSubmit,
	QuestionnaireTitle,
};
