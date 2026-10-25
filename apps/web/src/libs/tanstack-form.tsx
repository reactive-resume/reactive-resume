import { createFormHook, createFormHookContexts } from "@tanstack/react-form";

// Forms render their fields with `form.Field`; no shared field components are registered.
const { fieldContext, formContext } = createFormHookContexts();

export const { useAppForm } = createFormHook({
	fieldComponents: {},
	fieldContext,
	formComponents: {},
	formContext,
});
