package me.rxresu.core.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.core.DataStore
import java.io.File
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.coroutines.flow.first

private object AuthDataStore {
    private var instance: DataStore<Preferences>? = null
    @Synchronized fun get(context: Context): DataStore<Preferences> = instance ?: PreferenceDataStoreFactory.create {
        File(context.noBackupFilesDir, "auth_ciphertext.preferences_pb")
    }.also { instance = it }
}

internal interface AuthStorage {
    suspend fun read(key: String): String?
    suspend fun write(key: String, value: String?)
}

/** DataStore contains only AES-GCM ciphertext; key never leaves AndroidKeyStore. No backup of credentials. */
internal class EncryptedAuthStorage(context: Context) : AuthStorage {
    private val store = AuthDataStore.get(context.applicationContext)
    private val key: SecretKey by lazy {
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keystore.getKey("rr.auth.v1", null) as? SecretKey) ?: KeyGenerator.getInstance("AES", "AndroidKeyStore").run {
            init(KeyGenParameterSpec.Builder("rr.auth.v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build())
            generateKey()
        }
    }

    override suspend fun read(key: String): String? {
        val encoded = store.data.first()[stringPreferencesKey(key)] ?: return null
        val packed = Base64.getDecoder().decode(encoded)
        require(packed.size >= 12 + 16)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, this.key, GCMParameterSpec(128, packed.copyOfRange(0, 12)))
        cipher.updateAAD(key.toByteArray())
        return String(cipher.doFinal(packed.copyOfRange(12, packed.size)), Charsets.UTF_8)
    }

    override suspend fun write(key: String, value: String?) {
        val encrypted = value?.let {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, this.key)
            cipher.updateAAD(key.toByteArray())
            Base64.getEncoder().encodeToString(cipher.iv + cipher.doFinal(it.toByteArray()))
        }
        store.edit { prefs: androidx.datastore.preferences.core.MutablePreferences ->
            val name: Preferences.Key<String> = stringPreferencesKey(key)
            if (encrypted == null) prefs.remove(name) else prefs[name] = encrypted
        }
    }
}
