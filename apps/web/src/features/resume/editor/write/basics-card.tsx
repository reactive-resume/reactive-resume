import type { Basics, CustomField } from "@reactive-resume/schema/resume/data";
import { i18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Icon } from "@reactive-resume/ui/components/icon";
import { IconButton } from "@reactive-resume/ui/components/icon-button";
import { Input } from "@reactive-resume/ui/components/input";
import { Popover, PopoverContent, PopoverTrigger } from "@reactive-resume/ui/components/popover";
import { generateId } from "@reactive-resume/utils/string";
import { TextField, validateEmail, WebsiteField } from "./fields";
import { PictureSettings } from "./picture-settings";
import { SectionsCrumb } from "./section-view";
import { IconPicker } from "@/components/input/icon-picker";
import { useCurrentBuilderResumeSelector, useUpdateResumeData } from "@/features/resume/builder/draft";
import { PanelBody, PanelHeader } from "@/features/resume/editor/chrome/panel";

type TextKey = "name" | "headline" | "email" | "phone" | "location";

function useBasicsWriter() {
	const updateResumeData = useUpdateResumeData();
	return (key: string, mutate: (basics: Basics) => void) =>
		updateResumeData((draft) => mutate(draft.basics), { coalesceKey: `basics.${key}` });
}

/**
 * Basics: who the resume is about. The photo, name and headline, then how to reach them and any extra fields. It is
 * always first on the page, whose header selects it.
 */
export function BasicsView({ locked }: { locked: boolean }) {
	const basics = useCurrentBuilderResumeSelector((resume) => resume.data.basics);
	const resumeId = useCurrentBuilderResumeSelector((resume) => resume.id);
	const write = useBasicsWriter();
	const updateResumeData = useUpdateResumeData();

	const text = (key: TextKey) => ({
		value: basics[key],
		onChange: (value: string) =>
			write(key, (target) => {
				target[key] = value;
			}),
	});

	return (
		<PanelBody id="sidebar-basics" className="pb-6">
			<PanelHeader crumb={<SectionsCrumb />} title={<Trans>Basics</Trans>} />
			<fieldset disabled={locked} className="m-0 mt-3 grid min-w-0 grid-cols-2 items-start gap-3 border-0 p-0">
				<PictureSettings key={resumeId} locked={locked} />
				<TextField
					label={<Trans>Full name</Trans>}
					wide
					autoComplete="name"
					// A blank resume opens straight into the name field.
					autoFocus={!locked && !basics.name}
					{...text("name")}
				/>
				<TextField label={<Trans>Headline</Trans>} wide {...text("headline")} />
				{/* Addresses run long: Email gets a full row, also in a narrow panel. */}
				<TextField
					label={<Trans>Email</Trans>}
					wide
					type="email"
					autoComplete="email"
					validate={validateEmail}
					{...text("email")}
				/>
				<TextField label={<Trans>Phone</Trans>} type="tel" autoComplete="tel" {...text("phone")} />
				<TextField label={<Trans>Location</Trans>} {...text("location")} />
				<WebsiteField
					label={<Trans>Website</Trans>}
					value={basics.website}
					allowInlineLink={false}
					onChange={(website) =>
						write("website", (target) => {
							target.website = { url: website.url, label: website.label };
						})
					}
				/>
				<div className="col-span-full grid gap-1.5">
					<span className="text-[13px]/[18px] font-medium">
						<Trans>Custom fields</Trans>
					</span>
					<CustomFields
						fields={basics.customFields}
						locked={locked}
						edit={(key, mutate) =>
							updateResumeData((draft) => mutate(draft.basics.customFields), {
								coalesceKey: `basics.customFields.${key}`,
							})
						}
					/>
				</div>
			</fieldset>
		</PanelBody>
	);
}

/**
 * Extra contact details (icon, text and an optional link), as "Add field" under Website. `edit` changes the list where
 * it's kept: the resume's basics, or a letter's own sender details.
 */
type CustomFieldsProps = {
	fields: CustomField[];
	locked: boolean;
	edit: (key: string, mutate: (list: CustomField[]) => void) => void;
};
export function CustomFields({ fields, locked, edit }: CustomFieldsProps) {
	return (
		<div className="col-span-full grid gap-2">
			{fields.map((field, index) => (
				<div key={field.id} className="flex items-center gap-1.5">
					<IconPicker
						disabled={locked}
						value={field.icon}
						popoverProps={{ modal: true }}
						onChange={(icon) =>
							edit(`${field.id}.icon`, (list) => {
								const target = list[index];
								if (target) target.icon = icon;
							})
						}
					/>
					<Input
						disabled={locked}
						aria-label={t`Field ${i18n.number(index + 1)}`}
						dir="auto"
						value={field.text}
						onChange={(event) =>
							edit(`${field.id}.text`, (list) => {
								const target = list[index];
								if (target) target.text = event.target.value;
							})
						}
					/>
					<Popover>
						<PopoverTrigger
							render={
								<IconButton
									disabled={locked}
									icon={field.link ? "link-simple-horizontal" : "link-simple-horizontal-break"}
									label={field.link ? t`Edit link` : t`Add a link`}
									className={field.link ? "text-accent-text" : "text-ink-3"}
								/>
							}
						/>
						<PopoverContent align="end" className="w-72">
							<Input
								disabled={locked}
								type="url"
								dir="ltr"
								aria-label={t`Link address`}
								placeholder="https://"
								value={field.link}
								onChange={(event) =>
									edit(`${field.id}.link`, (list) => {
										const target = list[index];
										if (target) target.link = event.target.value;
									})
								}
							/>
						</PopoverContent>
					</Popover>
					<IconButton
						icon="arrow-up"
						label={t`Move field up`}
						size="icon-sm"
						disabled={locked || index === 0}
						onClick={() => edit(`${field.id}.move`, (list) => list.splice(index - 1, 0, ...list.splice(index, 1)))}
					/>
					<IconButton
						icon="x"
						label={t`Remove field`}
						disabled={locked}
						size="icon-sm"
						onClick={() => edit(`${field.id}.remove`, (list) => list.splice(index, 1))}
					/>
				</div>
			))}
			<button
				type="button"
				disabled={locked}
				className="flex h-7 w-fit items-center gap-1.5 rounded-xs text-sm/5 font-medium text-accent-text hover:underline disabled:pointer-events-none disabled:opacity-45"
				onClick={() => edit("add", (list) => list.push({ id: generateId(), icon: "acorn", text: "", link: "" }))}
			>
				<Icon name="plus" size={16} />
				<Trans>Add field</Trans>
			</button>
		</div>
	);
}
