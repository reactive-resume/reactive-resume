package me.rxresu.core.network

import java.time.ZoneId
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.*
import me.rxresu.core.network.generated.*
import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class ApiClientTest {
    private class Tokens : SessionTokens {
        var token="old";var refreshed=0
        override suspend fun accessToken()=token
        override suspend fun refresh(rejected: String): String { assertEquals("old",rejected);refreshed++;token="new";return token }
    }
    private fun client(server: MockWebServer,tokens: Tokens=Tokens(),rejected: suspend(String)->Unit = {}): ApiClient = ApiClient(
        object:ServerOrigin { override val origin=MutableStateFlow(server.url("/").toString().trimEnd('/')) },tokens,
        timezone={ZoneId.of("Europe/Lisbon")},onRejectedRetry=rejected,
    )
    private fun json(body: String,code: Int=200)=MockResponse.Builder().code(code).addHeader("Content-Type","application/json").body(body).build()
    @Test fun token401RefreshesExactlyOnceAndRetriesBufferedBody()=runTest {
        MockWebServer().apply { start() }.use { server ->
            server.enqueue(json("{\"code\":\"UNAUTHORIZED\",\"message\":\"expired\"}",401));server.enqueue(json("{\"ok\":true}"))
            val tokens=Tokens();val api=client(server,tokens)
            val request=ApiRequest("test","POST","/test",body=buildJsonObject { put("text","kept") })
            assertTrue(api.execute(request).jsonObject["ok"]!!.jsonPrimitive.boolean)
            val first=server.takeRequest(5,TimeUnit.SECONDS)!!;val second=server.takeRequest(5,TimeUnit.SECONDS)!!
            assertEquals("Bearer old",first.headers["Authorization"]);assertEquals("Bearer new",second.headers["Authorization"])
            assertEquals(first.body,second.body);assertEquals("Europe/Lisbon",first.headers["x-client-timezone"])
            assertEquals("/api/openapi/test",first.url.encodedPath);assertEquals(1,tokens.refreshed)
        }
    }
    @Test fun password401DoesNotRefresh()=runTest {
        MockWebServer().apply { start() }.use { server ->
            server.enqueue(json("{\"code\":\"NEED_PASSWORD\",\"message\":\"Password required\"}",401))
            val tokens=Tokens();val error=runCatching { client(server,tokens).execute(ApiRequest("test","GET","/test")) }.exceptionOrNull() as ApiException
            assertEquals("NEED_PASSWORD",error.code);assertEquals(401,error.status);assertEquals("Password required",error.message)
            assertEquals(0,tokens.refreshed);assertEquals(1,server.requestCount)
        }
    }
    @Test fun rejectedRetryExpiresSessionWithoutThirdRequest()=runTest {
        MockWebServer().apply { start() }.use { server ->
            repeat(2) { server.enqueue(json("{\"code\":\"UNAUTHORIZED\"}",401)) }
            var expired:String?=null;val tokens=Tokens()
            assertTrue(runCatching { client(server,tokens) { expired=it }.execute(ApiRequest("test","GET","/test")) }.exceptionOrNull() is ApiException)
            assertEquals("new",expired);assertEquals(1,tokens.refreshed);assertEquals(2,server.requestCount)
        }
    }
    @Test fun streamParsesIdsTypesMultilineAndRefreshesBeforeOpening()=runTest {
        MockWebServer().apply { start() }.use { server ->
            server.enqueue(json("{\"code\":\"UNAUTHORIZED\"}",401))
            server.enqueue(MockResponse.Builder().addHeader("Content-Type","text/event-stream").body("id: 7\nevent: delta\ndata: first\ndata: second\n\ndata: done\n\n").build())
            val tokens=Tokens();val events=client(server,tokens).events(ApiRequest("stream","GET","/stream")).toList()
            assertEquals(listOf(ServerEvent("7","delta","first\nsecond"),ServerEvent("7",null,"done")),events)
            assertEquals(1,tokens.refreshed)
        }
    }
    @Test fun cancellationClosesStream()=runTest {
        MockWebServer().apply { start() }.use { server ->
            server.enqueue(MockResponse.Builder().addHeader("Content-Type","text/event-stream").body("data: one\n\ndata: two\n\n").build())
            assertEquals("one",client(server).events(ApiRequest("stream","GET","/stream")).take(1).single().data)
        }
    }
    @Test fun unknownEnumsAndUnionVariantsSurvive() {
        assertEquals(ApplicationStage.Unknown,ApiJson.decodeFromString(ApplicationStage.serializer(),"\"future-stage\""))
        val entry=ApiJson.decodeFromString(TimelineEntry.serializer(),"{\"type\":\"future-event\",\"custom\":42}")
        assertTrue(entry is TimelineEntry.Unknown)
        assertEquals("future-event",ApiJson.encodeToJsonElement(TimelineEntry.serializer(),entry).jsonObject["type"]!!.jsonPrimitive.content)
    }
    @Test fun generatedDomainNamingAndStructuralDedupeStayStable() {
        assertEquals(Resume::class.java,ResumesApiOperations::class.java.methods.first { it.name=="getResume" }.genericParameterTypes.last().let { (it as java.lang.reflect.ParameterizedType).actualTypeArguments[0].let { t -> (t as java.lang.reflect.WildcardType).lowerBounds[0] } })
        val update=ApiJson.decodeFromJsonElement(UpdateResumeRequest.serializer(),buildJsonObject { put("tags",JsonArray(emptyList())) })
        assertEquals(JsonArray(emptyList()),ApiJson.encodeToJsonElement(UpdateResumeRequest.serializer(),update).jsonObject["tags"])
        assertEquals(ResumeData::class.java,Resume::class.java.getDeclaredField("data").type)
    }
    @Test fun generatedOperationsRoundTripServerShapesAndEncodeQueryPathAndBinary()=runTest {
        MockWebServer().apply { start() }.use { server ->
            val api=ResumesApi(client(server))
            val resume=ApiSamples.response("getResume").jsonObject.with("id",JsonPrimitive("r/1")).with("name",JsonPrimitive("Product designer"))
            server.enqueue(json(resume.toString()))
            assertEquals("Product designer",api.getResume("r/1").name)
            assertEquals("/api/openapi/resumes/r%2F1",server.takeRequest(5,TimeUnit.SECONDS)!!.url.encodedPath)
            val bytes=byteArrayOf(0,1,2,-1)
            server.enqueue(MockResponse.Builder().addHeader("Content-Type","application/pdf").body(okio.Buffer().write(bytes)).build())
            assertArrayEquals(bytes,api.downloadResumePdf("r1").bytes)
        }
    }
    @Test fun multipartUsesRealBytesAndEnumPathWireValue()=runTest {
        MockWebServer().apply { start() }.use { server ->
            server.enqueue(json(ApiSamples.response("getApplication").toString()))
            ApplicationsApi(client(server)).attachApplicationDocument("app",AttachApplicationDocumentKind.Resume,UploadPart("ignored",byteArrayOf(0,1,2),"resume.pdf","application/pdf"))
            val request=server.takeRequest(5,TimeUnit.SECONDS)!!
            assertEquals("/api/openapi/applications/app/documents/resume",request.url.encodedPath)
            assertTrue(request.headers["Content-Type"]!!.startsWith("multipart/form-data"))
            assertTrue(request.body!!.utf8().contains("filename=\"resume.pdf\""))
        }
    }
    @Test fun healthUsesConfiguredOriginRootAndPublicCallsKeepOnlyResumeAccessCookies()=runTest {
        MockWebServer().apply { start() }.use { server ->
            val client=client(server)
            server.enqueue(json(ApiSamples.response("getHealth").toString()))
            SystemApi(client).getHealth()
            val health=server.takeRequest(5,TimeUnit.SECONDS)!!
            assertEquals("/api/health",health.url.encodedPath);assertNull(health.headers["Authorization"])
            server.enqueue(MockResponse.Builder().addHeader("Content-Type","application/json").addHeader("Set-Cookie","resume_access_r1=grant; Path=/; Max-Age=600").addHeader("Set-Cookie","auth_session=must-not-be-forwarded; Path=/").body("true").build())
            client.execute(ApiRequest("verify","POST","/verify",options=RequestOptions(authenticated=false)))
            server.takeRequest(5,TimeUnit.SECONDS)
            server.enqueue(json("{}"))
            client.execute(ApiRequest("public","GET","/public",options=RequestOptions(authenticated=false)))
            assertEquals("resume_access_r1=grant",server.takeRequest(5,TimeUnit.SECONDS)!!.headers["Cookie"])
        }
    }
    @Test fun generatedMixedMultipartOperationUsesMultipartRatherThanJsonFileNames()=runTest {
        MockWebServer().apply { start() }.use { server ->
            server.enqueue(json("\"new-app\""))
            val result=ApplicationsApi(client(server)).createApplicationMultipart(company="Lumen",role="Designer",resumeFile=UploadPart("file","%PDF".toByteArray(),"resume.pdf","application/pdf"))
            assertEquals("new-app",result)
            val request=server.takeRequest(5,TimeUnit.SECONDS)!!
            assertTrue(request.headers["Content-Type"]!!.startsWith("multipart/form-data"))
            val body=request.body!!.utf8();assertTrue(body.contains("%PDF"));assertTrue(body.contains("name=\"company\""));assertTrue(body.contains("Lumen"))
        }
    }
    @Test fun optionalNullableFieldsCanBeExplicitlyClearedWithoutClearingOtherFields()=runTest {
        MockWebServer().apply { start() }.use { server ->
            server.enqueue(json(ApiSamples.response("getApplication").toString()))
            ApplicationsApi(client(server)).patchApplication("app",PatchApplicationRequest(followUpAt=null),RequestOptions(nullFields=setOf("/followUpAt")))
            val body=ApiJson.parseToJsonElement(server.takeRequest(5,TimeUnit.SECONDS)!!.body!!.utf8()).jsonObject
            assertEquals(JsonNull,body["followUpAt"]);assertFalse(body.containsKey("company"));assertFalse(body.containsKey("resumeId"))
        }
    }
    private fun JsonObject.with(key: String,value: JsonElement)=JsonObject(this+(key to value))
}
