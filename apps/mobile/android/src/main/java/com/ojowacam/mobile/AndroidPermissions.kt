package com.ojowacam.mobile

import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener

/**
 * Runtime permission checks/requests for dangerous permissions (camera, mic).
 * Uses PermissionAwareActivity so the system dialog can be shown from native code.
 */
class AndroidPermissions(private val reactContext: ReactApplicationContext) {

    private var nextRequestCode = 4200
    private val listeners = mutableMapOf<Int, PermissionListener>()

    fun has(permission: String): Boolean {
        return ContextCompat.checkSelfPermission(reactContext, permission) ==
            PackageManager.PERMISSION_GRANTED
    }

    /**
     * Ensure [permissions] are granted. If already granted, invokes [onGranted] immediately.
     * Otherwise shows the system dialog and resolves the flow via [promise].
     * Rejects [promise] if denied or if no PermissionAwareActivity is available.
     */
    fun ensure(permissions: Array<String>, promise: Promise, onGranted: () -> Unit) {
        val missing = permissions.filter { !has(it) }
        if (missing.isEmpty()) {
            onGranted()
            return
        }

        val activity = reactContext.currentActivity
        if (activity !is PermissionAwareActivity) {
            promise.reject(
                "E_PERMISSION",
                "Cannot request permissions (${missing.joinToString()}): no PermissionAwareActivity",
            )
            return
        }

        val requestCode = nextRequestCode++
        val listener = PermissionListener { reqCode, perms, grantResults ->
            if (reqCode != requestCode) {
                false
            } else {
                val allGranted = perms.indices.all { i ->
                    grantResults.getOrNull(i) == PackageManager.PERMISSION_GRANTED
                }
                listeners.remove(reqCode)
                if (allGranted) {
                    onGranted()
                } else {
                    val denied = perms.filterIndexed { i, _ ->
                        grantResults.getOrNull(i) != PackageManager.PERMISSION_GRANTED
                    }
                    promise.reject(
                        "E_PERMISSION_DENIED",
                        "Permission denied: ${denied.joinToString()}",
                    )
                }
                true
            }
        }
        listeners[requestCode] = listener
        activity.requestPermissions(missing.toTypedArray(), requestCode, listener)
    }

    fun ensureCamera(promise: Promise, onGranted: () -> Unit) {
        ensure(arrayOf(android.Manifest.permission.CAMERA), promise, onGranted)
    }

    fun ensureMicrophone(promise: Promise, onGranted: () -> Unit) {
        ensure(arrayOf(android.Manifest.permission.RECORD_AUDIO), promise, onGranted)
    }
}
