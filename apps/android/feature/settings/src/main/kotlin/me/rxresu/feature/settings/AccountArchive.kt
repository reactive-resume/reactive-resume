package me.rxresu.feature.settings

import java.io.OutputStream
import java.net.URLEncoder
import java.util.Base64
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.serialization.json.*

/**
 * Web account-zip layout and bounds. Validate every server-provided path before writing an archive
 * entry.
 */
internal fun writeAccountArchive(data: JsonObject, output: OutputStream) {
    val paths = mutableSetOf<String>()
    var total = 0L
    fun component(value: String) = URLEncoder.encode(value, "UTF-8").replace(".", "%2E")
    ZipOutputStream(output).use { zip ->
        fun add(path: String, bytes: ByteArray) {
            require(paths.add(path)) { "Duplicate archive path" }
            check(total + bytes.size <= 64L * 1024 * 1024 && paths.size <= 50_000) {
                "Archive limit"
            }
            total += bytes.size
            zip.putNextEntry(ZipEntry(path))
            zip.write(bytes)
            zip.closeEntry()
        }
        fun json(path: String, value: JsonElement) =
            add(path, (value.toString() + "\n").toByteArray())
        json(
            "account.json",
            buildJsonObject {
                put("exportedAt", data.getValue("exportedAt"))
                put("user", data.getValue("user"))
            },
        )
        listOf(
                "applications" to "applications.json",
                "applicationPipeline" to "application-stages.json",
                "career" to "career.json",
                "applicationProfile" to "application-profile.json",
                "documentVersions" to "document-versions.json",
                "feedback" to "feedback.json",
                "aiContentReports" to "ai-content-reports.json",
            )
            .forEach { (key, path) ->
                data[key]?.takeUnless { it == JsonNull }?.let { json(path, it) }
            }
        listOf("resumes" to "resumes", "coverLetters" to "letters").forEach { (key, directory) ->
            data[key]?.jsonArray?.forEach { item ->
                val document = item.jsonObject
                val record =
                    if (key == "coverLetters")
                        JsonObject(
                            document +
                                mapOf(
                                    "format" to JsonPrimitive("reactive-resume-cover-letter"),
                                    "version" to JsonPrimitive(1),
                                )
                        )
                    else document
                json(
                    "$directory/${component(document.getValue("id").jsonPrimitive.content)}.json",
                    record,
                )
            }
        }
        (data["documentVersions"] as? JsonObject)?.let { versions ->
            listOf("resumes" to "resumeId", "letters" to "coverLetterId").forEach { (kind, owner) ->
                versions[kind]?.jsonArray?.forEach { item ->
                    val row = item.jsonObject
                    json(
                        "versions/$kind/${component(row.getValue(owner).jsonPrimitive.content)}/${component(row.getValue("id").jsonPrimitive.content)}.json",
                        row,
                    )
                }
            }
        }
        (data["uploads"] as? JsonObject)?.let { uploads ->
            val user = data.getValue("user").jsonObject.getValue("id").jsonPrimitive.content
            require(user.matches(Regex("[A-Za-z0-9_-]+")))
            var uploaded = 0L
            val included = buildJsonArray {
                val files = uploads.getValue("files").jsonArray
                check(files.size <= 500) { "Archive limit" }
                files.forEach { item ->
                    val file = item.jsonObject
                    val key = file.getValue("key").jsonPrimitive.content
                    require(
                        key.startsWith("uploads/$user/") &&
                            key.split('/').all { it.matches(Regex("[A-Za-z0-9_-][A-Za-z0-9._-]*")) }
                    ) {
                        "Invalid upload path"
                    }
                    val encoded = file.getValue("base64").jsonPrimitive.content
                    check(encoded.length <= ((8 * 1024 * 1024 + 2) / 3) * 4) { "Archive limit" }
                    val bytes = Base64.getDecoder().decode(encoded)
                    uploaded += bytes.size
                    check(bytes.size <= 8 * 1024 * 1024 && uploaded <= 16 * 1024 * 1024) {
                        "Archive limit"
                    }
                    add(key, bytes)
                    add(
                        buildJsonObject {
                            put("key", key)
                            put("path", key)
                            put("bytes", bytes.size)
                        }
                    )
                }
            }
            json(
                "upload-manifest.json",
                buildJsonObject {
                    put("format", 1)
                    put("exportedAt", data.getValue("exportedAt"))
                    put("included", included)
                    put("skipped", uploads.getValue("skipped"))
                    put(
                        "coverage",
                        "Files referenced by exported records. External URLs and unreferenced/deleted files are not fetched.",
                    )
                },
            )
        }
    }
}
