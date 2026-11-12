package me.rxresu.feature.career

import android.content.Context
import android.util.AtomicFile
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.RepositoriesProvider
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.network.AccountChangedException
import me.rxresu.core.network.ApiJson
import me.rxresu.core.network.RequestOptions
import me.rxresu.core.network.generated.*
import androidx.work.*

private val diskScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
private fun digest(value: String) = MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

@Serializable
internal data class CareerEdit(val key: String, val value: String, val kind: String? = null, val revision: String = UUID.randomUUID().toString())

/** Recovery and delivery share one atomic record. Sign-out retains it, but only its owner may send it. */
internal class CareerDrafts(
    context: Context,
    owner: String,
    private val scope: CoroutineScope = diskScope,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val persisted: () -> Unit = {},
) {
    private val directory = File(context.noBackupFilesDir, "career/" + digest(owner))
    // Shared across screen/worker instances: an old response must never remove newer words.
    private val disk = synchronized(disks) { disks.getOrPut(directory.path) { Disk() } }
    private val gate get() = disk.gate
    private val pending get() = disk.pending
    private fun file(key: String) = AtomicFile(File(directory, digest(key) + ".json"))
    private fun decode(key: String, text: String) = runCatching { ApiJson.decodeFromString(CareerEdit.serializer(), text) }.getOrElse { CareerEdit(key, text) }
    private fun readDisk(key: String): CareerEdit? = file(key).let { f -> if (f.baseFile.exists() || File(f.baseFile.path + ".bak").exists()) decode(key, f.openRead().bufferedReader().use { it.readText() }) else null }
    private fun put(edit: CareerEdit) {
        check(directory.isDirectory || directory.mkdirs())
        val target = file(edit.key)
        val stream = target.startWrite()
        try { stream.write(ApiJson.encodeToString(CareerEdit.serializer(), edit).toByteArray()); stream.fd.sync(); target.finishWrite(stream); check(readDisk(edit.key)?.revision == edit.revision) { "Could not keep draft" } }
        catch (e: Exception) { target.failWrite(stream); throw e }
    }
    suspend fun read(key: String): String? {
        flush(key)
        return withContext(io) { gate.withLock { readDisk(key)?.value } }
    }
    suspend fun write(key: String, value: String) { enqueue(key, value).await() }
    /** No disk access or debounce on input. Superseded writes coalesce while the last write outlives its screen. */
    fun enqueue(key: String, value: String, kind: String? = null, failed: (Throwable) -> Unit = {}): Deferred<Unit> = synchronized(pending) {
        val edit = CareerEdit(key, value, kind)
        val task = scope.async(start = CoroutineStart.LAZY) {
            try {
                withContext(io) { gate.withLock {
                    if (synchronized(pending) { pending[key]?.first?.revision } == edit.revision) { put(edit); if (kind != null) persisted() }
                } }
            } catch (e: CancellationException) { throw e }
            catch (e: Exception) { if (synchronized(pending) { pending[key]?.first?.revision } == edit.revision) failed(e); throw e }
        }
        pending[key] = edit to task
        task.start()
        task
    }
    suspend fun flush(key: String) {
        while (true) {
            val task = synchronized(pending) { pending[key]?.second } ?: return
            task.await()
            if (synchronized(pending) { pending[key]?.second } === task) return
        }
    }
    suspend fun remove(key: String) {
        flush(key)
        withContext(io) { gate.withLock { file(key).delete() } }
    }
    suspend fun queued(): List<CareerEdit> = withContext(io) { gate.withLock {
        directory.listFiles().orEmpty().map { if (it.extension == "bak") File(it.path.removeSuffix(".bak")) else it }.distinct()
            .filter { it.extension == "json" }.mapNotNull { f ->
            val text = AtomicFile(f).openRead().bufferedReader().use { it.readText() }
            val edit = runCatching { ApiJson.decodeFromString(CareerEdit.serializer(), text) }.getOrNull()
            if (edit != null) edit.takeIf { it.kind != null }
            else {
                // Upgrade pre-queue recovery files in place; coach drafts must never be sent automatically.
                val key = if (f.name == digest("preferences") + ".json") "preferences" else {
                    val story = runCatching { ApiJson.decodeFromString(SaveCareerStoryRequest.serializer(), text) }.getOrNull()
                    story?.takeIf { it.title.isNotBlank() }?.let { value ->
                        listOf("story:${value.id}", "story:new").firstOrNull { f.name == digest(it) + ".json" }
                    }
                }
                key?.let { CareerEdit(it, text, if (it == "preferences") "preferences" else "story").also(::put) }
            }
        }
    } }
    suspend fun acknowledge(edit: CareerEdit) {
        flush(edit.key)
        withContext(io) { gate.withLock { if (readDisk(edit.key)?.revision == edit.revision) file(edit.key).delete() } }
    }
    private class Disk {
        val gate = Mutex()
        val pending = mutableMapOf<String, Pair<CareerEdit, Deferred<Unit>>>()
    }
    companion object { private val disks = mutableMapOf<String, Disk>() }
}

private const val WORK = "rr-career-sync"
internal fun scheduleCareerSync(context: Context, origin: String, owner: String) {
    val request = OneTimeWorkRequestBuilder<CareerSyncWorker>()
        .setInputData(workDataOf("origin" to origin, "owner" to owner))
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS)
        .build()
    val name = "$WORK:${digest("$origin:$owner")}"
    val manager = WorkManager.getInstance(context)
    // Periodic delivery closes the final-scan/enqueue race and the persist-before-schedule crash window.
    manager.enqueueUniquePeriodicWork(name, ExistingPeriodicWorkPolicy.KEEP,
        PeriodicWorkRequestBuilder<CareerSyncWorker>(15, TimeUnit.MINUTES)
            .setInputData(workDataOf("origin" to origin, "owner" to owner))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS).build())
    manager.enqueueUniqueWork("$name:now", ExistingWorkPolicy.KEEP, request)
}

/** Call once from app scope, including sign-in after restart; no career screen needs to be reopened. */
fun startCareerSync(context: Context, scope: CoroutineScope): Job = scope.launch {
    val repositories = (context.applicationContext as RepositoriesProvider).repositories
    var previous: Pair<String, String>? = null
    combine(repositories.account.session, repositories.authSession.origin) { session, origin -> origin to (session as? SessionState.SignedIn)?.accountScope }
        .collect { (origin, owner) ->
            val current = owner?.let { origin to it }
            if (previous != current) {
                previous?.let { (oldOrigin, oldOwner) ->
                    val name = "$WORK:${digest("$oldOrigin:$oldOwner")}"
                    WorkManager.getInstance(context).cancelUniqueWork(name)
                    WorkManager.getInstance(context).cancelUniqueWork("$name:now")
                }
                if (owner != null) scheduleCareerSync(context, origin, owner)
                previous = current
            }
        }
}

internal suspend fun deliverCareerEdits(repositories: RrRepositories, drafts: CareerDrafts, origin: String, owner: String) {
    fun current() = repositories.owner() == owner && repositories.authSession.origin.value == origin
    val options = RequestOptions(accountScope = owner)
    for (edit in drafts.queued()) {
        if (!current()) throw AccountChangedException()
        when (edit.kind) {
            "story" -> repositories.career.saveCareerStory(ApiJson.decodeFromString(SaveCareerStoryRequest.serializer(), edit.value), options)
            "preferences" -> {
                val profile = ApiJson.decodeFromString(CareerProfile.serializer(), edit.value)
                repositories.career.updateCareerProfile(profile.preferencesRequest(), options.copy(nullFields = buildSet {
                    if (profile.maxOfficeDays == null) add("/maxOfficeDays")
                    if (profile.noticeWeeks == null) add("/noticeWeeks")
                    if (profile.minBase.amount == null) add("/minBase/amount")
                }))
            }
        }
        if (!current()) throw AccountChangedException()
        drafts.acknowledge(edit)
    }
}

/** Default constructor uses the installed repository graph through WorkManager's reflection fallback. */
class CareerSyncWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    override suspend fun doWork(): Result = syncGate.withLock {
        val repositories = (applicationContext as RepositoriesProvider).repositories
        val origin = inputData.getString("origin") ?: return@withLock Result.failure()
        val owner = inputData.getString("owner") ?: return@withLock Result.failure()
        if (repositories.owner() != owner || repositories.authSession.origin.value != origin) return@withLock Result.success()
        try {
            deliverCareerEdits(repositories, CareerDrafts(applicationContext, "$origin:$owner"), origin, owner)
            Result.success()
        } catch (e: CancellationException) { throw e }
        catch (_: AccountChangedException) { Result.success() }
        catch (_: Exception) { Result.retry() }
    }
    companion object { internal val syncGate = Mutex() }
}
