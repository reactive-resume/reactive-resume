import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import { RequestHeadersPlugin, StrictGetMethodPlugin } from "@orpc/server/plugins";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { env } from "@reactive-resume/env/server";
import { appVersion } from "../app-version";
import { mergeResponseHeaders } from "../http/headers";
import { getRequestLocale } from "../rpc/locale";
import { generateOpenApiSpec, openAPIRouter } from "./generator";

const openAPIHandler = new OpenAPIHandler(openAPIRouter, {
	filter: ({ contract }) => !contract["~orpc"].route.tags?.includes("Internal"),
	plugins: [
		new RequestHeadersPlugin(),
		new StrictGetMethodPlugin(),
		new SmartCoercionPlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			console.error("[OpenAPI]", error);
		}),
	],
});

export async function handleOpenApi(request: Request, trustedClient: string) {
	const pathname = new URL(request.url).pathname;
	if (request.method === "GET" && ["/api/openapi/spec.json", "/api/openapi/spec"].includes(pathname)) {
		return Response.json(await generateOpenApiSpec({ appUrl: env.APP_URL, version: appVersion }));
	}

	const resHeaders = new Headers();
	const { response } = await openAPIHandler.handle(request, {
		prefix: "/api/openapi",
		context: { locale: getRequestLocale(request), reqHeaders: request.headers, resHeaders, trustedClient },
	});

	resHeaders.set("Cache-Control", "no-store");
	resHeaders.set("X-Content-Type-Options", "nosniff");
	if (!response)
		return Response.json(
			{ defined: false, code: "NOT_FOUND", status: 404, message: "Not found" },
			{ status: 404, headers: resHeaders },
		);
	return mergeResponseHeaders(response, resHeaders);
}
