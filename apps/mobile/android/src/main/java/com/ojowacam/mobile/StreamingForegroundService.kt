package com.ojowacam.mobile

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat

class StreamingForegroundService : Service() {

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // TODO: Start foreground streaming notification
        return Service.START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startForeground() {
        val notification = NotificationCompat.Builder(this, "ojowacam_streaming")
            .setContentTitle("Ojowacam Streaming")
            .setContentText("Camera is active")
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .build()

        startForeground(1, notification)
    }
}
