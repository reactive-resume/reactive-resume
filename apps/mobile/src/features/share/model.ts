export const safeFileName = (name: string) =>
	Array.from(name)
		.filter((character) => character.charCodeAt(0) >= 32)
		.join("")
		.replace(/[<>:"/\\|?*]/g, "")
		.replace(/^\.+|[. ]+$/g, "")
		.trim()
		.slice(0, 100);
