import java.io.File
import org.gradle.api.*
import org.gradle.api.file.*
import org.gradle.api.tasks.*
import org.gradle.kotlin.dsl.*
import com.android.build.api.variant.LibraryAndroidComponentsExtension
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import java.security.MessageDigest

// Kept in this module: no buildSrc, compiler subprocess, or external generator at build time.
class RrSpecGenerator(private val spec: Map<String, Any?>, private val output: File) {
    private fun obj(value: Any?): Map<String, Any?> = (value as? Map<*, *>)?.entries?.associate { it.key.toString() to it.value } ?: emptyMap()
    private fun list(value: Any?): List<Any?> = value as? List<*> ?: emptyList()
    private fun quote(value: String) = JsonOutput.toJson(value).replace("$", "\\$")
    private fun pascal(value: String): String = value.split(Regex("[^A-Za-z0-9]+")).filter { it.isNotEmpty() }.joinToString("") { it.replaceFirstChar(Char::uppercaseChar) }.let { if (it.firstOrNull()?.isDigit() == true) "Value$it" else it.ifEmpty { "Value" } }
    private fun field(value: String) = "`$value`"
    private val keys = setOf("type", "properties", "required", "items", "enum", "const", "anyOf", "oneOf", "additionalProperties", "format", "contentMediaType")
    private fun canonical(value: Any?, propertyMap: Boolean = false): String = when (value) {
        is Map<*, *> -> value.entries.filter { propertyMap || it.key in keys }.sortedBy { it.key.toString() }.joinToString(",", "{", "}") { quote(it.key.toString()) + ":" + canonical(it.value, it.key == "properties") }
        is List<*> -> value.map { canonical(it) }.sorted().joinToString(",", "[", "]")
        else -> JsonOutput.toJson(value)
    }
    private fun hash(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).take(6).joinToString("") { "%02x".format(it) }
    private fun resolve(value: Any?): Map<String, Any?> {
        val s = obj(value)
        val ref = s["\$ref"] as? String ?: return s
        require(ref.startsWith("#/")) { "External schema references unsupported: $ref" }
        return ref.removePrefix("#/").split('/').fold(spec as Any?) { parent, key -> obj(parent)[key.replace("~1", "/").replace("~0", "~")] }.let(::resolve)
    }
    private fun variants(s: Map<String, Any?>) = list(s["oneOf"] ?: s["anyOf"]).map(::resolve)
    private fun isNull(s: Map<String, Any?>) = s["type"]=="null" || s["enum"]==listOf<Any?>(null) || (s.containsKey("const") && s["const"]==null)
    private fun nullable(s: Map<String, Any?>) = isNull(s) || variants(s).any(::isNull)
    private fun normalized(value: Any?): Map<String, Any?> {
        val s = resolve(value)
        val v = variants(s).filter { !isNull(it) }
        return if (v.size == 1) normalized(v.single()) else s
    }
    private fun discriminant(s: Map<String, Any?>): String? {
        val vs = variants(s).filter { !isNull(it) }
        if (vs.size < 2 || vs.any { it["type"] != "object" }) return null
        return obj(vs.first()["properties"]).keys.sorted().firstOrNull { key ->
            val values = vs.map { resolve(obj(it["properties"])[key])["const"] }
            values.all { it is String } && values.distinct().size == vs.size
        }
    }
    private data class Definition(val schema: Map<String, Any?>, val hints: MutableSet<String> = sortedSetOf(), var pinned: String? = null)
    private val definitions = linkedMapOf<String, Definition>()
    private val names = mutableMapOf<String, String>()
    private val parents = mutableMapOf<String, MutableSet<String>>()
    private fun isFile(value: Any?): Boolean { val s=resolve(value); return s["contentMediaType"]!=null || s["format"]=="binary" || (variants(s).isNotEmpty() && variants(s).all { isFile(it) }) }
    private fun isEnum(s: Map<String, Any?>) = (list(s["enum"]).isNotEmpty() && list(s["enum"]).all { it is String }) || s["const"] is String
    private fun isModel(s: Map<String, Any?>) = isEnum(s) || obj(s["properties"]).isNotEmpty() || discriminant(s) != null
    private fun collect(value: Any?, hint: String) {
        val s = normalized(value)
        if (isModel(s)) {
            val key = canonical(s)
            val existing = definitions[key]
            if (existing != null) { existing.hints += hint; return }
            definitions[key] = Definition(s, sortedSetOf(hint))
        }
        obj(s["properties"]).toSortedMap().forEach { (k, v) -> collect(v, hint + pascal(k)) }
        s["items"]?.let { collect(it, hint + "Item") }
        s["additionalProperties"]?.let { if (it is Map<*, *>) collect(it, hint + "Value") }
        variants(s).forEachIndexed { i, v -> collect(v, hint + pascal(obj(v["properties"]).toSortedMap().values.map(::resolve).firstOrNull { it["const"] is String }?.get("const")?.toString() ?: "Variant${i + 1}") ) }
    }
    private fun pin(value: Any?, name: String) {
        val s = normalized(value)
        if (!isModel(s)) return
        collect(s, name)
        definitions.getValue(canonical(s)).pinned = name
    }
    private fun type(value: Any?, hint: String = "Value"): String {
        val raw = resolve(value)
        val s = normalized(raw)
        val base = if (isModel(s)) names.getValue(canonical(s)) else when (s["type"]) {
            "string" -> "String"
            "integer" -> "Long"
            "number" -> "Double"
            "boolean" -> "Boolean"
            "array" -> "List<${type(s["items"], hint + "Item")}>"
            "object" -> "Map<String, ${if (obj(s["additionalProperties"]).isEmpty()) "JsonElement" else type(s["additionalProperties"], hint + "Value")}>"
            else -> when (s["const"]) { is Number -> "Long"; is Boolean -> "Boolean"; else -> "JsonElement" }
        }
        return if (nullable(raw) && !base.endsWith('?')) "$base?" else base
    }
    private data class Operation(val method: String, val path: String, val value: Map<String, Any?>) {
        val id get() = value["operationId"].toString()
        val tag get() = (value["tags"] as? List<*>)?.firstOrNull()?.toString() ?: "System"
    }
    private val operations = obj(spec["paths"]).flatMap { (path, value) -> obj(value).filterKeys { it in setOf("get", "post", "put", "patch", "delete", "head", "options") }.map { (method, raw) ->
        val op = obj(raw).toMutableMap()
        if (op["operationId"] == null) op["operationId"] = method + pascal(path)
        Operation(method.uppercase(), path, op)
    } }.flatMap { op ->
        val content = obj(obj(op.value["requestBody"])["content"])
        if(content.containsKey("application/json") && content.containsKey("multipart/form-data")) listOf(op, op.copy(value=op.value + mapOf("operationId" to op.id+"Multipart", "requestBody" to (obj(op.value["requestBody"])+mapOf("content" to mapOf("multipart/form-data" to content["multipart/form-data"])))))) else listOf(op)
    }.sortedBy { it.id }
    private fun response(op: Operation) = obj(obj(op.value["responses"]).entries.firstOrNull { it.key.startsWith('2') }?.value)
    private fun responseContent(op: Operation) = obj(response(op)["content"])
    private fun responseSchema(op: Operation) = obj(responseContent(op)["application/json"])["schema"]
    private fun requestContent(op: Operation) = obj(obj(op.value["requestBody"])["content"])
    private fun requestSchema(op: Operation) = obj(requestContent(op)["application/json"])["schema"]
    private val header = "// Generated from docs/spec.json. Change the generator, never this file.\npackage me.rxresu.core.network.generated\n\nimport kotlinx.serialization.*\nimport kotlinx.serialization.json.*\nimport kotlinx.serialization.descriptors.*\nimport kotlinx.serialization.encoding.*\nimport kotlinx.coroutines.flow.Flow\nimport me.rxresu.core.network.*\n\n"
    private fun write(name: String, body: String) { File(output, "$name.kt").writeText(header + body) }
    fun generate() {
        operations.forEach { op ->
            collect(responseSchema(op), pascal(op.id) + "Response")
            collect(requestSchema(op), pascal(op.id) + "Request")
            list(op.value["parameters"]).map(::obj).forEach { collect(it["schema"], pascal(op.id) + pascal(it["name"].toString())) }
            obj(requestContent(op)["multipart/form-data"])["schema"]?.let { s -> obj(resolve(s)["properties"]).filterValues { !isFile(it) }.forEach { (k,v) -> collect(v, pascal(op.id)+pascal(k)) } }
        }
        val domainNames = mapOf("getResume" to "Resume", "getApplication" to "Application", "getCoverLetter" to "CoverLetter", "getProfile" to "AccountProfile", "getApplicationProfile" to "ApplicationProfile", "getCareerProfile" to "CareerProfile", "getCareerWorkspace" to "CareerWorkspace", "getAgentThread" to "AgentConversation", "getFeatureFlags" to "FeatureFlags")
        operations.forEach { op -> domainNames[op.id]?.let { pin(responseSchema(op), it) } }
        val itemNames = mapOf("listResumes" to "ResumeSummary", "listDocuments" to "DocumentSummary", "listCareerFacts" to "CareerFact", "listCareerStories" to "Story", "listCareerSavedItems" to "SavedItem", "listCareerSchedules" to "CareerSchedule", "listCareerNotifications" to "CareerNotification", "listCareerOpportunities" to "Opportunity", "listApplicationSummaries" to "ApplicationSummary", "listResumeVersions" to "ResumeVersionSummary", "listCoverLetterVersions" to "LetterVersionSummary")
        operations.forEach { op -> itemNames[op.id]?.let { pin(resolve(responseSchema(op))["items"], it) } }
        val resume = resolve(responseSchema(operations.first { it.id == "getResume" }))
        pin(obj(resume["properties"])["data"], "ResumeData")
        val data = resolve(obj(resume["properties"])["data"])
        obj(data["properties"]).toSortedMap().forEach { (key,v) -> pin(v,if(key=="summary") "ResumeSummarySection" else "Resume"+pascal(key)) }
        val app = resolve(responseSchema(operations.first { it.id == "getApplication" }))
        pin(obj(app["properties"])["status"],"ApplicationStage")
        val timeline = resolve(resolve(obj(app["properties"])["activity"])["items"])
        pin(timeline,"TimelineEntry")
        variants(timeline).forEach { v -> val t = resolve(obj(v["properties"])["type"])["const"]; pin(v, if(t=="interview") "Interview" else pascal(t.toString())+"TimelineEntry") }
        val docs = resolve(responseSchema(operations.first { it.id == "listDocuments" }))["items"]
        pin(obj(resolve(docs)["properties"])["type"], "DocumentType")
        val saved = resolve(resolve(responseSchema(operations.first { it.id == "listCareerSavedItems" }))["items"])
        val savedData = obj(saved["properties"])["data"]
        pin(savedData,"SavedData")
        variants(resolve(savedData)).forEach { v ->
            val kind=resolve(obj(v["properties"])["kind"])["const"].toString()
            pin(v, when(kind) { "offer" -> "Offer"; "briefing" -> "Briefing"; "practice" -> "PracticeAttempt"; "reply" -> "MessageDraft"; "fit" -> "FitResult"; "debrief" -> "Debrief"; else -> pascal(kind)+"Data" })
        }
        definitions.toSortedMap().forEach { (key,d) -> names[key] = d.pinned ?: d.hints.minWith(compareBy<String> { it.length }.thenBy { it }).let { if(it.length>100) it.take(80)+hash(key) else it } }
        names.entries.groupBy { it.value }.values.filter { it.size>1 }.forEach { group -> group.forEach { names[it.key] = it.value + hash(it.key) } }
        definitions.forEach { (key,d) -> if(discriminant(d.schema)!=null) variants(d.schema).forEach { child -> parents.getOrPut(canonical(normalized(child))) { sortedSetOf() } += names.getValue(key) } }
        output.deleteRecursively(); output.mkdirs()
        definitions.forEach { (key,d) ->
            val name = names.getValue(key); val s=d.schema
            when {
                isEnum(s) -> {
                    val values = if(s.containsKey("const")) listOf(s["const"].toString()) else list(s["enum"]).map { it.toString() }
                    val enumNames = values.associateWith { pascal(it).let { n -> if(n=="Unknown") "KnownUnknown" else n } }.toMutableMap()
                    enumNames.entries.groupBy { it.value }.values.filter { it.size>1 }.forEach { g -> g.forEach { enumNames[it.key]=it.value+hash(it.key) } }
                    write(name, "@Serializable(with = ${name}Serializer::class)\nenum class $name(val wireValue: String) {\n"+values.joinToString("\n") { "    @SerialName(${quote(it)}) ${enumNames.getValue(it)}(${quote(it)})," }+"\n    Unknown(\"__unknown__\");\n}\n\nobject ${name}Serializer : KSerializer<$name> {\n    override val descriptor = PrimitiveSerialDescriptor(\"$name\", PrimitiveKind.STRING)\n    override fun deserialize(decoder: Decoder): $name { val value = decoder.decodeString(); return $name.entries.firstOrNull { it.wireValue == value } ?: $name.Unknown }\n    override fun serialize(encoder: Encoder, value: $name) = encoder.encodeString(value.wireValue)\n}\n")
                }
                discriminant(s)!=null -> {
                    val disc=discriminant(s)!!; val vs=variants(s).filter { !isNull(it) }
                    val branches = vs.map { v -> names.getValue(canonical(normalized(v))) to resolve(obj(v["properties"])[disc])["const"].toString() }
                    write(name,"@Serializable(with = ${name}Serializer::class)\nsealed interface $name {\n    data class Unknown(val raw: JsonElement) : $name\n}\n\nobject ${name}Serializer : KSerializer<$name> {\n    override val descriptor = JsonElement.serializer().descriptor\n    override fun deserialize(decoder: Decoder): $name {\n        val input = decoder as JsonDecoder\n        val raw = input.decodeJsonElement()\n        return when ((raw as? JsonObject)?.get(${quote(disc)})?.jsonPrimitive?.contentOrNull) {\n"+branches.joinToString("\n") { (n,v)-> "            ${quote(v)} -> input.json.decodeFromJsonElement($n.serializer(), raw)" }+"\n            else -> $name.Unknown(raw)\n        }\n    }\n    override fun serialize(encoder: Encoder, value: $name) {\n        val output = encoder as JsonEncoder\n        val raw = when(value) {\n"+branches.joinToString("\n") { (n,_)->"            is $n -> output.json.encodeToJsonElement($n.serializer(), value)" }+"\n            is $name.Unknown -> value.raw\n        }\n        output.encodeJsonElement(raw)\n    }\n}\n")
                }
                else -> {
                    val required=list(s["required"]).map { it.toString() }.toSet()
                    val fields=obj(s["properties"]).toSortedMap().map { (k,v) ->
                        var t=type(v); val optional=k !in required
                        val default=if(optional) { if(!t.endsWith('?')) t+="?"; " = null" } else if(t.endsWith('?')) " = null" else ""
                        "    @SerialName(${quote(k)}) val ${field(k)}: $t$default"
                    }
                    val parent=parents[key]?.joinToString(", "," : ") ?: ""
                    // Open objects (`additionalProperties: {}`) keep the keys the spec doesn't name, so a read-modify-write
                    // never drops them (resume items, agent message parts).
                    val open=s["additionalProperties"].let { it == true || (it is Map<*, *> && it.isEmpty()) }
                    if(open) write(name,"@OptIn(ExperimentalSerializationApi::class)\n@KeepGeneratedSerializer\n@Serializable(with = ${name}Serializer::class)\ndata class $name(\n"+fields.joinToString(",\n")+",\n    /** Keys the spec allows but doesn't name, kept as sent. */\n    @Transient val extraFields: JsonObject = JsonObject(emptyMap()),\n)$parent\n\nobject ${name}Serializer : OpenObjectSerializer<$name>($name.generatedSerializer(), { it.extraFields }, { value, extra -> value.copy(extraFields = extra) })\n")
                    else write(name,"@Serializable\ndata class $name(\n"+fields.joinToString(",\n")+"\n)$parent\n")
                }
            }
        }
        operations.groupBy { pascal(it.tag)+"Api" }.forEach { (api,ops) ->
            val signatures=mutableListOf<String>();val implementations=mutableListOf<String>()
            ops.forEach { op ->
                val ps=list(op.value["parameters"]).map(::obj)
                val params=ps.map { p -> val t=type(p["schema"]); field(p["name"].toString())+": "+t+(if(p["required"]!=true) (if(!t.endsWith('?')) "?" else "")+" = null" else "") }.toMutableList()
                val body=requestSchema(op)
                val multipart=if(body==null) obj(requestContent(op)["multipart/form-data"])["schema"] else null
                val multipartProps=obj(resolve(multipart)["properties"])
                if(body!=null) params += "body: "+type(body)+(if(obj(op.value["requestBody"])["required"]!=true) "? = null" else "")
                if(multipart!=null) {val required=list(resolve(multipart)["required"]);multipartProps.forEach { (k,v) ->val file=isFile(v); val t=if(file) "UploadPart" else type(v);params+=field(k)+": "+t+(if(k !in required) (if(!t.endsWith('?')) "?" else "")+" = null" else "") } }
                params += "options: RequestOptions = RequestOptions("+(if(op.value.containsKey("security") && list(op.value["security"]).isEmpty()) "authenticated = false" else "")+")"
                val content=responseContent(op)
                val stream=content.containsKey("text/event-stream")
                val binary=content.isNotEmpty() && !content.containsKey("application/json") && !stream
                val result=when {stream->"Flow<ServerEvent>";binary->"BinaryFile";responseSchema(op)!=null->type(responseSchema(op));else->"Unit"}
                val fn=op.id.split(Regex("[^A-Za-z0-9]+")).mapIndexed { i,v -> if(i==0) v else pascal(v) }.joinToString("")
                val suspend=if(stream) "" else "suspend "
                signatures += "    /** ${op.method} ${op.path} */\n    ${suspend}fun $fn(${params.joinToString(", ")}): $result"
                val pathParams=ps.filter { it["in"]=="path" }.joinToString(", ") { quote(it["name"].toString())+" to "+"ApiJson.encodeToJsonElement("+field(it["name"].toString())+").jsonPrimitive.content" }
                val query=ps.filter { it["in"]=="query" }.joinToString(", ") { val k=it["name"].toString(); "${quote(k)} to ${field(k)}?.let { ApiJson.encodeToJsonElement(it) }" }
                val headers=ps.filter { it["in"]=="header" }.joinToString(", ") { val k=it["name"].toString(); "${quote(k)} to ${field(k)}?.let { ApiJson.encodeToJsonElement(it).jsonPrimitive.content }" }
                val multipartCode=if(multipart!=null) "listOfNotNull("+multipartProps.entries.joinToString(", ") { (k,v) -> val isFile=isFile(v);if(isFile) field(k)+"?.named(${quote(k)})" else field(k)+"?.let { UploadPart.text(${quote(k)}, ApiJson.encodeToJsonElement(it)) }" }+")" else "emptyList()"
                val request="ApiRequest(${quote(op.id)}, ${quote(op.method)}, ${quote(op.path)}, mapOf($pathParams), mapOf($query), "+(if(body!=null) "body?.let { ApiJson.encodeToJsonElement(it) }" else "null")+", $multipartCode, mapOf($headers), options, rootPath = ${list(op.value["servers"]).isNotEmpty()})"
                val expression=when {stream->"transport.events($request)";binary->"transport.download($request)";result=="Unit"->"transport.execute($request).let { Unit }";else->"ApiJson.decodeFromJsonElement(transport.execute($request))"}
                val overrideParams=params.map { it.substringBefore(" = ") }
                implementations += "    override ${suspend}fun $fn(${overrideParams.joinToString(", ")}): $result =\n        $expression"
            }
            write(api,"interface ${api}Operations {\n"+signatures.joinToString("\n\n")+"\n}\n\nclass $api(private val transport: ApiTransport) : ${api}Operations {\n"+implementations.joinToString("\n\n")+"\n}\n")
        }
        write("ApiSamples","/** Minimal structural examples for deterministic preview transports, never real personal data. */\nobject ApiSamples {\n    fun response(operation: String): JsonElement = when(operation) {\n"+operations.filter { responseSchema(it)!=null }.joinToString("\n") { "        ${quote(it.id)} -> ApiJson.parseToJsonElement(${quote(JsonOutput.toJson(sample(responseSchema(it))))})" }+"\n        else -> JsonNull\n    }\n    fun request(operation: String): JsonElement = when(operation) {\n"+operations.filter { requestSchema(it)!=null }.joinToString("\n") { "        ${quote(it.id)} -> ApiJson.parseToJsonElement(${quote(JsonOutput.toJson(sample(requestSchema(it))))})" }+"\n        else -> JsonNull\n    }\n}\n")
        File(output,"operations.tsv").writeText(operations.joinToString("\n") { "${it.tag}\t${it.id}\t${it.method}\t${it.path}" })
        println("Generated ${operations.size} operations and ${definitions.size} deduplicated models")
    }
    fun namedSchemas(): Map<String,String> = names.toMap()
    private fun sample(value: Any?, depth: Int = 0): Any? {
        if(depth>35) return null
        val raw=resolve(value); val s=normalized(raw)
        if(nullable(raw)) return null
        if(s.containsKey("const")) return s["const"]
        if(list(s["enum"]).isNotEmpty()) return list(s["enum"]).first()
        if(variants(s).isNotEmpty()) return sample(variants(s).first(),depth+1)
        return when(s["type"]) {
            "object" -> obj(s["properties"]).filterKeys { it in list(s["required"]) }.mapValues { sample(it.value,depth+1) }
            "array" -> emptyList<Any>()
            "string" -> if(s["format"]=="date-time") "2026-11-07T09:00:00Z" else if(s["format"]=="uri") "https://example.invalid" else ""
            "number","integer" -> 0
            "boolean" -> false
            else -> null
        }
    }
}

abstract class GenerateRrApiTask : DefaultTask() {
    @get:InputFile @get:PathSensitive(PathSensitivity.RELATIVE) abstract val specFile: RegularFileProperty
    @get:OutputDirectory abstract val outputDirectory: DirectoryProperty
    @TaskAction fun generate() {
        @Suppress("UNCHECKED_CAST")
        val spec = JsonSlurper().parse(specFile.get().asFile) as Map<String, Any?>
        RrSpecGenerator(spec, outputDirectory.get().asFile.resolve("me/rxresu/core/network/generated")).generate()
    }
}

abstract class VerifyRrApiTask : DefaultTask() {
    @get:InputFile @get:PathSensitive(PathSensitivity.RELATIVE) abstract val specFile: RegularFileProperty
    @get:OutputDirectory abstract val outputDirectory: DirectoryProperty
    private fun reverseMaps(value: Any?): Any? = when(value) {
        is Map<*, *> -> value.entries.reversed().associate { it.key to reverseMaps(it.value) }
        is List<*> -> value.map(::reverseMaps)
        else -> value
    }
    @TaskAction fun verify() {
        @Suppress("UNCHECKED_CAST")
        val spec=JsonSlurper().parse(specFile.get().asFile) as Map<String,Any?>
        val first=RrSpecGenerator(spec,outputDirectory.get().asFile.resolve("original"))
        @Suppress("UNCHECKED_CAST")
        val second=RrSpecGenerator(reverseMaps(spec) as Map<String,Any?>,outputDirectory.get().asFile.resolve("reordered"))
        first.generate();second.generate()
        check(first.namedSchemas()==second.namedSchemas()) { "Schema property/path ordering changed deduplicated model names: "+first.namedSchemas().filter { (k,v) -> second.namedSchemas()[k]!=v }.map { (k,v) -> v+" -> "+second.namedSchemas()[k] }.take(10) }
        check(first.namedSchemas().values.distinct().size==first.namedSchemas().size) { "Model name collision." }
    }
}

class ApiClientConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) = with(target) {
        val generator=tasks.register<GenerateRrApiTask>("generateApiClient") {
            specFile.set(rootProject.layout.projectDirectory.file("../../docs/spec.json"))
            outputDirectory.set(layout.buildDirectory.dir("generated/rr-api/kotlin"))
        }
        val verify=tasks.register<VerifyRrApiTask>("verifyApiGenerator") {
            specFile.set(rootProject.layout.projectDirectory.file("../../docs/spec.json"))
            outputDirectory.set(layout.buildDirectory.dir("generator-verification"))
        }
        tasks.matching { it.name=="testDebugUnitTest" }.configureEach { dependsOn(verify) }
        extensions.configure<LibraryAndroidComponentsExtension> {
            onVariants { variant ->
                variant.sources.kotlin?.addGeneratedSourceDirectory(generator,GenerateRrApiTask::outputDirectory)
            }
        }
    }
}
