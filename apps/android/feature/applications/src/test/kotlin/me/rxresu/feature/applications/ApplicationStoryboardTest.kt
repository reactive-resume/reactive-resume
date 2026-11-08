package me.rxresu.feature.applications

import kotlinx.coroutines.runBlocking
import me.rxresu.core.network.generated.ApplicationStage
import me.rxresu.core.testing.RrScreenshotTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ApplicationStoryboardTest : RrScreenshotTest() {
    @Test fun appliedFixtureCopiesKeepEveryOriginalClosedRecordAndResolveById() = runBlocking {
        applicationStoryboard().use { repos ->
            val apps = repos.applications.listApplications()
            assertEquals(6, apps.count { it.status == ApplicationStage.Closed })
            assertEquals(4, apps.count { it.status == ApplicationStage.Applied })
            repeat(2) { index ->
                val id = "application-applied-storyboard-$index"
                val stored = repos.applications.getApplication(id)
                assertEquals(ApplicationStage.Applied, stored.status)
                assertNull(stored.closedReason)
                assertEquals(apps.single { it.id == id }, stored)
            }
            repeat(9) { index -> assertEquals(ApplicationStage.Closed, repos.applications.getApplication("application-closed-$index").status) }
        }
    }
}
