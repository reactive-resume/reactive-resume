package me.rxresu.core.data

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.*
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.*
import me.rxresu.core.auth.AuthSession
import me.rxresu.core.auth.SessionState
import me.rxresu.core.database.CachedList
import me.rxresu.core.database.CacheDao
import me.rxresu.core.network.*

internal fun SessionState.scope(): String? = when(this) {
    is SessionState.SignedIn -> accountScope
    is SessionState.Expired -> accountScope
    else -> null
}
internal interface ListCache {
    suspend fun get(scope: String,key: String): String?
    suspend fun put(scope: String,key: String,value: String)
}
internal class RoomListCache(private val dao: CacheDao,private val time: TimeSource) : ListCache {
    override suspend fun get(scope: String,key: String)=dao.get(scope,key)?.json
    override suspend fun put(scope: String,key: String,value: String)=dao.put(CachedList(scope,key,value,time.now().toEpochMilli()))
}
internal class MemoryListCache : ListCache {
    private val values=java.util.concurrent.ConcurrentHashMap<Pair<String,String>,String>()
    override suspend fun get(scope: String,key: String)=values[scope to key]
    override suspend fun put(scope: String,key: String,value: String) { values[scope to key]=value }
}

/** Mutations invalidate observers; a network failure can fall back only to this account's cached reads. */
internal class RepositoryStore(
    private val delegate: ApiTransport,
    val auth: AuthSession,
    val cache: ListCache,
    val time: TimeSource,
) : ApiTransport {
    val changes=MutableStateFlow(0L)
    internal val offlineGeneration=java.util.concurrent.atomic.AtomicLong()
    fun refresh() { changes.update { it+1 } }
    private val cached=setOf("listDocuments","listDocumentPage","countDocuments","listApplications","listApplicationSummaries","getApplicationLanes","getCareerProfile","listCareerNotifications","listCareerOpportunities","listCareerSavedItems","listCareerSchedules","listCareerFacts","listCareerStories","getProfile")
    private fun key(r: ApiRequest)=r.operation+":"+JsonObject(r.query.filterValues { it!=null }.mapValues { it.value!! }.toSortedMap())
    private fun owned(scope: String?) { if(auth.state.value.scope()!=scope) throw AccountChangedException() }
    override suspend fun execute(request: ApiRequest): JsonElement {
        val scope=request.options.accountScope ?: auth.state.value.scope()
        if(request.options.authenticated) owned(scope)
        val captured=if(request.options.authenticated) request.copy(options=request.options.copy(accountScope=scope)) else request
        val value=try { delegate.execute(captured) } catch(e: CancellationException) { throw e } catch(e: IOException) {
            if(e is ApiException || e is AccountChangedException || scope==null || request.operation !in cached) throw e
            owned(scope)
            return cache.get(scope,key(request))?.let { offlineGeneration.incrementAndGet();ApiJson.parseToJsonElement(it) } ?: throw e
        }
        if(request.options.authenticated) owned(scope)
        if(scope!=null && request.operation in cached) cache.put(scope,key(request),value.toString())
        if(request.method!="GET") refresh()
        return value
    }
    override suspend fun download(request: ApiRequest): BinaryFile=delegate.download(request)
    override fun events(request: ApiRequest): Flow<ServerEvent> = delegate.events(request.copy(options=request.options.copy(accountScope=request.options.accountScope ?: auth.state.value.scope())))

    @OptIn(ExperimentalCoroutinesApi::class)
    fun <T> observe(key: String,serializer: KSerializer<T>,load: suspend ()->T): Flow<Resource<T>> = combine(auth.state,changes) { session,_ -> session }
        .flatMapLatest { session -> flow {
            val scope=session.scope()
            if(scope==null) { emit(Resource<T>()); return@flow }
            val cached=cache.get(scope,key)?.let { runCatching { ApiJson.decodeFromString(serializer,it) }.getOrNull() }
            emit(Resource(cached,loading=session is SessionState.SignedIn,offline=session is SessionState.Expired))
            if(session !is SessionState.SignedIn) return@flow
            try {
                val attempt=offlineGeneration.get()
                val fresh=load(); owned(scope)
                cache.put(scope,key,ApiJson.encodeToString(serializer,fresh))
                emit(Resource(fresh,offline=offlineGeneration.get()!=attempt))
            } catch(e: CancellationException) { throw e } catch(e: Exception) {
                owned(scope)
                emit(Resource(cached,error=e,offline=e is IOException && e !is ApiException))
            }
        } }.distinctUntilChanged()
}
