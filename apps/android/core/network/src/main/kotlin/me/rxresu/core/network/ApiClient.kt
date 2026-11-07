package me.rxresu.core.network

import java.io.IOException
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.channels.trySendBlocking
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.json.*
import okhttp3.*
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources

@OptIn(ExperimentalSerializationApi::class)
val ApiJson = Json { ignoreUnknownKeys = true; explicitNulls = false; coerceInputValues = true }

class ApiException(val status: Int, val code: String?, override val message: String, val data: JsonElement? = null) : IOException(message)
class AccountChangedException : IOException("Account changed before the request completed.")

data class RequestOptions(
    val accountScope: String? = null,
    val authenticated: Boolean = true,
    val headers: Map<String, String> = emptyMap(),
    /** Optional nullable DTO fields otherwise mean omission. JSON pointers here explicitly clear fields. */
    val nullFields: Set<String> = emptySet(),
)

data class UploadPart(val name: String, val bytes: ByteArray, val filename: String? = null, val contentType: String = "application/octet-stream") {
    fun named(name: String) = copy(name = name)
    companion object {
        fun text(name: String, value: JsonElement) = UploadPart(name, (if(value is JsonPrimitive) value.content else value.toString()).toByteArray(), contentType = "text/plain; charset=utf-8")
    }
}

data class ApiRequest(
    val operation: String,
    val method: String,
    val path: String,
    val pathParams: Map<String, String> = emptyMap(),
    val query: Map<String, JsonElement?> = emptyMap(),
    val body: JsonElement? = null,
    val parts: List<UploadPart> = emptyList(),
    val headers: Map<String, String?> = emptyMap(),
    val options: RequestOptions = RequestOptions(),
    val rootPath: Boolean = false,
)

data class BinaryFile(val bytes: ByteArray, val contentType: String?, val contentDisposition: String?)
fun ApiRequest.bodyWithExplicitNulls(): JsonElement? {
    fun clear(node: JsonElement,parts: List<String>): JsonElement {
        if(parts.isEmpty()) return JsonNull
        val key=parts.first()
        return when(node) {
            is JsonObject -> JsonObject(node+(key to clear(node[key] ?: JsonObject(emptyMap()),parts.drop(1))))
            is JsonArray -> JsonArray(node.toMutableList().apply { val index=key.toInt();this[index]=clear(this[index],parts.drop(1)) })
            else -> error("Explicit null path crosses a scalar value.")
        }
    }
    return options.nullFields.fold(body ?: JsonObject(emptyMap())) { value,pointer ->
        require(pointer.startsWith('/') && pointer.length>1) { "Explicit nulls need field JSON pointers." }
        clear(value,pointer.drop(1).split('/').map { it.replace("~1","/").replace("~0","~") })
    }.takeIf { body!=null || options.nullFields.isNotEmpty() }
}
data class ServerEvent(val id: String?, val type: String?, val data: String) {
    fun json(): JsonElement = ApiJson.parseToJsonElement(data)
}

interface ApiTransport {
    suspend fun execute(request: ApiRequest): JsonElement
    suspend fun download(request: ApiRequest): BinaryFile
    fun events(request: ApiRequest): Flow<ServerEvent>
}

/** No token/body logging; redirect following is disabled so credentials cannot travel to another origin. */
class ApiClient(
    private val origin: ServerOrigin,
    private val tokens: SessionTokens,
    http: OkHttpClient = OkHttpClient(),
    private val timezone: () -> ZoneId = { ZoneId.systemDefault() },
    private val accountScope: () -> String? = { null },
    // AuthSession currently has no reject method. The app/auth owner supplies expiry handling here.
    private val onRejectedRetry: suspend (String) -> Unit = {},
) : ApiTransport {
    private val cookies=java.util.concurrent.ConcurrentHashMap<Pair<String,String?>,List<Cookie>>()
    private val http = http.newBuilder()
        .cookieJar(CookieJar.NO_COOKIES)
        .connectTimeout(15, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS).callTimeout(120, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build()
    private val streaming = this.http.newBuilder().readTimeout(0, TimeUnit.SECONDS).callTimeout(0, TimeUnit.SECONDS).build()

    private data class Identity(val server: String, val scope: String?, val token: String?)
    private suspend fun identity(request: ApiRequest): Identity {
        val server = origin.origin.value.trimEnd('/')
        val scope = accountScope()
        if(request.options.accountScope != null && request.options.accountScope != scope) throw AccountChangedException()
        val token = if(request.options.authenticated) tokens.accessToken() else null
        return Identity(server, scope, token).also { guard(it) }
    }
    private fun guard(identity: Identity) {
        if(origin.origin.value.trimEnd('/') != identity.server || accountScope() != identity.scope) throw AccountChangedException()
    }
    private fun build(request: ApiRequest, identity: Identity): Request {
        val base = (identity.server + (if(request.rootPath) "/" else "/api/openapi/")).toHttpUrl()
        val url = base.newBuilder()
        request.path.trimStart('/').split('/').forEach { segment ->
            url.addPathSegment(if(segment.startsWith('{') && segment.endsWith('}')) request.pathParams.getValue(segment.drop(1).dropLast(1)) else segment)
        }
        fun query(key: String, value: JsonElement?) {
            when(value) {
                null, JsonNull -> Unit
                is JsonArray -> value.forEachIndexed { index, element -> query("$key[$index]", element) }
                is JsonObject -> value.forEach { (child, element) -> query("$key[$child]", element) }
                is JsonPrimitive -> url.addQueryParameter(key, value.content)
            }
        }
        request.query.forEach { (k,v) -> query(k,v) }
        val body = when {
            request.parts.isNotEmpty() -> MultipartBody.Builder().setType(MultipartBody.FORM).apply {
                request.parts.forEach { part -> addFormDataPart(part.name, part.filename, part.bytes.toRequestBody(part.contentType.toMediaType())) }
            }.build()
            request.body != null || request.options.nullFields.isNotEmpty() -> request.bodyWithExplicitNulls().toString().toRequestBody("application/json; charset=utf-8".toMediaType())
            request.method in setOf("POST", "PUT", "PATCH") -> ByteArray(0).toRequestBody(null)
            else -> null
        }
        return Request.Builder().url(url.build()).method(request.method, body)
            .header("Accept", "application/json").header("x-client-timezone", timezone().id)
            .apply {
                request.headers.forEach { (k,v) -> if(v!=null) header(k,v) }
                request.options.headers.forEach { (k,v) -> header(k,v) }
                removeHeader("Authorization")
                identity.token?.let { header("Authorization", "Bearer $it") }
                val granted=cookies[identity.server to identity.scope].orEmpty().filter { it.expiresAt>System.currentTimeMillis() && it.matches(url.build()) }
                if(granted.isNotEmpty()) header("Cookie",granted.joinToString("; ") { "${it.name}=${it.value}" })
            }.build()
    }
    private suspend fun Call.await(): Response = suspendCancellableCoroutine { continuation ->
        continuation.invokeOnCancellation { cancel() }
        enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { if(continuation.isActive) continuation.resumeWithException(e) }
            override fun onResponse(call: Call, response: Response) {
                continuation.resume(response) { _, value, _ -> value.close() }
            }
        })
    }
    private fun error(response: Response, body: String): ApiException {
        val json = runCatching { ApiJson.parseToJsonElement(body) as? JsonObject }.getOrNull()
        val nested = json?.get("error") as? JsonObject
        val value = nested ?: json
        return ApiException(response.code, value?.get("code")?.jsonPrimitive?.contentOrNull,
            value?.get("message")?.jsonPrimitive?.contentOrNull ?: "Request failed (${response.code}).", value?.get("data"))
    }
    private suspend fun response(request: ApiRequest, stream: Boolean = false): Pair<Response, Identity> {
        val identity = identity(request)
        val client = if(stream) streaming else http
        suspend fun send(who: Identity): Response {
            guard(who)
            return client.newCall(build(request, who)).await().also { response ->
                try { guard(who) } catch(e: AccountChangedException) { response.close(); throw e }
                val grants=Cookie.parseAll(response.request.url,response.headers).filter { it.name.startsWith("resume_access_") }
                if(grants.isNotEmpty()) cookies.compute(who.server to who.scope) { _,previous -> previous.orEmpty().filter { old -> grants.none { it.name==old.name } }+grants }
            }
        }
        var result = send(identity)
        if(result.code == 401 && identity.token != null) {
            val body = withContext(Dispatchers.IO) { result.body.string() }
            val unauthorized = body.contains("UNAUTHORIZED")
            if(!unauthorized) { val exception=error(result, body); result.close(); throw exception }
            result.close()
            val renewed = tokens.refresh(identity.token)
            guard(identity)
            if(renewed == null) throw error(result,body)
            val retry = identity.copy(token = renewed)
            result = send(retry)
            if(result.code == 401) onRejectedRetry(renewed)
        }
        if(!result.isSuccessful) {
            val exception = withContext(Dispatchers.IO) { error(result, result.body.string()) }
            result.close(); throw exception
        }
        return result to identity
    }
    override suspend fun execute(request: ApiRequest): JsonElement = withContext(Dispatchers.IO) {
        val (response, identity) = response(request)
        response.use { val body=it.body.string(); guard(identity); if(body.isBlank()) JsonNull else ApiJson.parseToJsonElement(body) }
    }
    override suspend fun download(request: ApiRequest): BinaryFile = withContext(Dispatchers.IO) {
        val (response, identity) = response(request)
        response.use { val result=BinaryFile(it.body.bytes(), it.header("Content-Type"), it.header("Content-Disposition")); guard(identity); result }
    }
    override fun events(request: ApiRequest): Flow<ServerEvent> = callbackFlow {
        var response: Response? = null
        val reader = launch(Dispatchers.IO) {
            try {
                val (opened, identity) = response(request.copy(options=request.options.copy(headers=request.options.headers + ("Accept" to "text/event-stream"))), stream=true)
                response=opened
                EventSources.processResponse(opened, object : EventSourceListener() {
                    override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                        try { guard(identity) } catch(e: AccountChangedException) { eventSource.cancel(); close(e); return }
                        if(trySendBlocking(ServerEvent(id,type,data)).isFailure) eventSource.cancel()
                    }
                    override fun onClosed(eventSource: EventSource) { close() }
                    override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) { close(t ?: IOException("Event stream ended unexpectedly.")) }
                })
            } catch(e: CancellationException) { throw e } catch(e: Exception) { close(e) }
        }
        awaitClose { response?.close(); reader.cancel() }
    }
}
