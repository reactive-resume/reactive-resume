package me.rxresu.feature.letters

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import me.rxresu.core.auth.SessionState
import me.rxresu.core.data.DraftState
import me.rxresu.core.data.RrRepositories
import me.rxresu.core.network.generated.CoverLetter
import me.rxresu.core.network.generated.GetCoverLetterVersionResponse

/** A version is read directly; opening it never acquires or restores the live letter's draft. */
internal class LetterSnapshotViewModel(private val repositories: RrRepositories, private val letterId: String, private val versionId: String) : ViewModel() {
    private val account = repositories.authSession.state.value
    private val origin = repositories.authSession.origin.value
    private val mutable = MutableStateFlow(LetterState(snapshotVersionId = versionId))
    val state = mutable.asStateFlow()
    private var request: Job? = null
    private var invalidated = false
    private fun sameAccount() = !invalidated && account is SessionState.SignedIn && repositories.authSession.state.value == account && repositories.authSession.origin.value == origin

    init {
        viewModelScope.launch {
            combine(repositories.authSession.state, repositories.authSession.origin) { session, server -> session == account && server == origin }.collect { same ->
                if (!same) {
                    invalidated = true
                    request?.cancel()
                    mutable.value = LetterState(snapshotVersionId = versionId, loading = false, failed = true)
                }
            }
        }
        retry()
    }

    fun retry() {
        request?.cancel()
        request = viewModelScope.launch {
            mutable.value = LetterState(snapshotVersionId = versionId)
            try {
                check(sameAccount())
                val version = repositories.letters.getCoverLetterVersion(letterId, versionId)
                check(version.id == versionId)
                val date = java.time.format.DateTimeFormatter.ofPattern("d MMM yyyy").withZone(repositories.time.timezone()).format(java.time.Instant.parse(version.createdAt))
                if (sameAccount()) mutable.value = LetterState(snapshotVersionId = versionId, snapshotLabel = listOfNotNull(version.name, date).joinToString(" · "), draft = DraftState(version.readOnlyLetter()), loading = false)
            } catch (e: CancellationException) { throw e } catch (_: Exception) {
                mutable.value = LetterState(snapshotVersionId = versionId, loading = false, failed = true)
            }
        }
    }
}

/** Presentation model only: version identity owns the prose, and no live links or revision are inferred. */
internal fun GetCoverLetterVersionResponse.readOnlyLetter() = CoverLetter(
    id = id, name = data.name, content = data.content, recipient = data.recipient, greeting = data.greeting, signOff = data.signOff,
    layout = data.layout, recipientName = data.recipientName, recipientCompany = data.recipientCompany, letterDate = data.letterDate,
    style = data.style, aiOperationIds = data.aiOperationIds, aiUsage = aiUsage, createdAt = createdAt, updatedAt = createdAt,
    isLocked = true, senderLinked = false, designLinked = false, revision = 0,
)
