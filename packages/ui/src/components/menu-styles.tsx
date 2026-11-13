/**
 * Popups start 4px back toward their trigger and settle outward, on whichever side they open. Base UI sets
 * `data-side` to top | bottom | left | right, or inline-start | inline-end when the side was given logically.
 */
export const popupSlideClassName =
	"data-[side=bottom]:data-starting-style:-translate-y-1 data-[side=bottom]:data-ending-style:-translate-y-1 data-[side=top]:data-starting-style:translate-y-1 data-[side=top]:data-ending-style:translate-y-1 data-[side=right]:data-starting-style:-translate-x-1 data-[side=right]:data-ending-style:-translate-x-1 data-[side=left]:data-starting-style:translate-x-1 data-[side=left]:data-ending-style:translate-x-1 ltr:data-[side=inline-end]:data-starting-style:-translate-x-1 ltr:data-[side=inline-end]:data-ending-style:-translate-x-1 rtl:data-[side=inline-end]:data-starting-style:translate-x-1 rtl:data-[side=inline-end]:data-ending-style:translate-x-1 ltr:data-[side=inline-start]:data-starting-style:translate-x-1 ltr:data-[side=inline-start]:data-ending-style:translate-x-1 rtl:data-[side=inline-start]:data-starting-style:-translate-x-1 rtl:data-[side=inline-start]:data-ending-style:-translate-x-1";

/**
 * Shared look for dropdown menus, context menus and combobox lists: `raised` with a hairline, 12px radius, e2, 4px
 * padding; 36px items with an 8px radius and 18px icons in ink-2. Group labels are the eyebrow style. Destructive
 * items go last, after a separator, in danger text; an unavailable item fades to 45%.
 * Submenus (`data-nested`) open in 120ms and close in 84ms: they open and close on every hover pass.
 */
export const menuPopupClassName = `relative z-50 max-h-(--available-height) min-w-[200px] origin-(--transform-origin) overflow-y-auto overflow-x-hidden rounded-lg border border-line bg-raised p-1 text-ink shadow-e2 outline-none transition-[opacity,scale,translate] duration-standard ease-enter data-ending-style:scale-[0.98] data-starting-style:scale-[0.98] data-closed:overflow-hidden data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:transition-none data-ending-style:duration-[calc(var(--d2)*0.7)] data-nested:duration-quick data-nested:data-ending-style:duration-[calc(var(--d1)*0.7)] ${popupSlideClassName}`;

export const menuItemClassName =
	"relative flex min-h-9 cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 text-ink text-sm leading-5 outline-hidden [--icon-size:18px] data-disabled:pointer-events-none data-highlighted:bg-hover data-inset:ps-[38px] data-disabled:opacity-45 data-[variant=destructive]:text-danger-text [&_[data-slot=icon]]:text-ink-2 data-[variant=destructive]:[&_[data-slot=icon]]:text-danger-text [&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

export const menuLabelClassName = "px-2.5 pt-2.5 pb-1 font-semibold text-xs leading-4 text-ink-3 data-inset:ps-[38px]";

export const menuSeparatorClassName = "my-1 h-px bg-line";

/** A shortcut at the end of an item, drawn as a key. */
export const menuShortcutClassName =
	"ms-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-xs bg-sunken px-[5px] font-mono text-[11px] leading-4 font-medium text-ink-3";
