import type { basicsSchema } from "@reactive-resume/schema/resume/data";
import type z from "zod";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { DotsSixVerticalIcon, LinkIcon, ListPlusIcon, XIcon } from "@phosphor-icons/react";
import { useStore } from "@tanstack/react-form";
import { Reorder, useDragControls } from "motion/react";
import { Button } from "@reactive-resume/ui/components/button";
import { FormControl, FormItem } from "@reactive-resume/ui/components/form";
import { Input } from "@reactive-resume/ui/components/input";
import { Label } from "@reactive-resume/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { generateId } from "@reactive-resume/utils/string";
import { IconPicker } from "@/components/input/icon-picker";
import { withForm } from "@/libs/tanstack-form";

type FormValues = z.infer<typeof basicsSchema>;
type CustomField = FormValues["customFields"][number];

const defaultValues: FormValues = {
	name: "",
	headline: "",
	email: "",
	phone: "",
	location: "",
	website: { url: "", label: "" },
	customFields: [],
};

export const CustomFieldsSection = withForm({
	defaultValues,
	render: ({ form }) => {
		const customFields = useStore(form.store, (state) => state.values.customFields ?? []);

		return (
			<form.Field name="customFields" mode="array">
				{(customFieldsField) => (
					<div className="space-y-4">
						<Reorder.Group
							axis="y"
							className="space-y-4"
							values={customFields}
							onReorder={(fields) => {
								customFieldsField.setValue(fields);
							}}
						>
							{customFields.map((field: CustomField, index: number) => (
								<CustomFieldItem key={field.id} field={field}>
									<form.Field name={`customFields[${index}].icon`}>
										{(iconField) => (
											<FormItem className="shrink-0">
												<FormControl
													render={
														<IconPicker
															name={iconField.name}
															value={iconField.state.value}
															className="rounded-r-none! border-e-0!"
															onChange={(icon) => {
																iconField.handleChange(icon);
															}}
														/>
													}
												/>
											</FormItem>
										)}
									</form.Field>

									<form.Field name={`customFields[${index}].text`}>
										{(textField) => (
											<FormItem className="flex-1">
												<FormControl
													render={
														<Input
															name={textField.name}
															value={textField.state.value}
															className="rounded-l-none!"
															onChange={(e) => {
																textField.handleChange(e.target.value);
															}}
														/>
													}
												/>
											</FormItem>
										)}
									</form.Field>

									<form.Field name={`customFields[${index}].link`}>
										{(linkField) => (
											<Popover>
												<PopoverTrigger
													render={
														<Button size="icon" variant="ghost" aria-label={t`Add link`} className="ms-1">
															<LinkIcon />
														</Button>
													}
												/>

												<PopoverContent align="center">
													<div className="flex flex-col gap-y-1.5">
														<Label htmlFor={linkField.name} className="text-muted-foreground text-xs">
															<Trans>Enter the URL to link to</Trans>
														</Label>

														<Input
															type="url"
															value={linkField.state.value}
															id={linkField.name}
															placeholder={t({
																comment: "Placeholder text for custom link URL field in resume builder",
																message: "Must start with https://",
															})}
															onChange={(e) => {
																linkField.handleChange(e.target.value);
															}}
														/>
													</div>
												</PopoverContent>
											</Popover>
										)}
									</form.Field>

									<Button
										size="icon"
										variant="ghost"
										aria-label={t`Remove custom field`}
										onClick={() => {
											customFieldsField.removeValue(index);
										}}
									>
										<XIcon />
									</Button>
								</CustomFieldItem>
							))}
						</Reorder.Group>

						<Button
							variant="ghost"
							onClick={() => {
								customFieldsField.pushValue({ id: generateId(), icon: "acorn", text: "", link: "" });
							}}
						>
							<ListPlusIcon />
							<Trans>Add a custom field</Trans>
						</Button>
					</div>
				)}
			</form.Field>
		);
	},
});

type CustomFieldItemProps = {
	field: CustomField;
	children: React.ReactNode;
};

function CustomFieldItem({ field, children }: CustomFieldItemProps) {
	const controls = useDragControls();

	return (
		<Reorder.Item value={field} dragListener={false} dragControls={controls} className="flex items-center">
			<Button
				size="icon"
				variant="ghost"
				aria-label={t`Reorder custom field`}
				className="me-2 touch-none"
				onPointerDown={(e) => {
					e.preventDefault();
					controls.start(e);
				}}
			>
				<DotsSixVerticalIcon />
			</Button>

			{children}
		</Reorder.Item>
	);
}
