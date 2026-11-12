package me.rxresu.core.auth

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/** Forward the unmodified callback to the app's launcher; MainActivity must call AuthService.handleRedirect. */
class OAuthRedirectActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val callback = intent?.data
        if (callback != null) {
            packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
                launch.data = callback
                launch.action = Intent.ACTION_VIEW
                launch.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                startActivity(launch)
            }
        }
        finish()
    }
}
