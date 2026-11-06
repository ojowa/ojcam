package com.ojowacam.mobile.usb

import android.app.Service
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbManager
import android.os.IBinder
import android.util.Log
import java.io.IOException
import java.net.ServerSocket
import java.net.Socket

class USBService : Service() {
    private companion object {
        const val TAG = "OjowacamUSB"
        const val ACTION_START_USB = "com.ojowacam.action.START_USB"
        const val ACTION_STOP_USB = "com.ojowacam.action.STOP_USB"
        const val EXTRA_DEVICE_ID = "device_id"
        const val EXTRA_LOCAL_PORT = "local_port"
        const val EXTRA_REMOTE_PORT = "remote_port"
    }

    private var usbManager: UsbManager? = null
    private var serverSocket: ServerSocket? = null
    private var listenThread: Thread? = null
    private var isListening = false
    private var localPort = 0

    // Callback for received streaming data
    var onDataReceived: ((ByteArray) -> Unit)? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        when (action) {
            ACTION_START_USB -> {
                val deviceId = intent?.getStringExtra(EXTRA_DEVICE_ID) ?: ""
                val localPort = intent?.getIntExtra(EXTRA_LOCAL_PORT, 8080)
                val remotePort = intent?.getIntExtra(EXTRA_REMOTE_PORT, 8081)
                startUSBTransport(deviceId, localPort, remotePort)
            }
            ACTION_STOP_USB -> {
                stopUSBTransport()
            }
        }
        return Service.START_NOT_STICKY
    }

    private fun startUSBTransport(deviceId: String, localPort: Int, remotePort: Int) {
        this.localPort = localPort
        usbManager = getSystemService(Context.USB_SERVICE) as UsbManager?

        // Enable USB tethering (requires specific permissions)
        enableUsbTethering()

        // Start listening on local port for computer-to-phone commands
        isListening = true
        listenThread = Thread {
            try {
                serverSocket = ServerSocket(localPort)
                while (isListening) {
                    try {
                        val client = serverSocket?.accept()
                        client?.use { socket ->
                            val input = socket.inputStream
                            val buffer = ByteArray(4096)
                            while (isListening) {
                                val bytesRead = input.read(buffer)
                                if (bytesRead > 0) {
                                    val data = buffer.copyOfRange(0, bytesRead)
                                    onDataReceived?.invoke(data)
                                }
                            }
                        }
                    } catch (e: IOException) {
                        if (isListening) {
                            Log.e(TAG, "Socket error", e)
                        }
                    }
                }
            } catch (e: IOException) {
                Log.e(TAG, "Failed to start server socket", e)
            }
        }
        listenThread?.start()

        Log.d(TAG, "USB transport started on port $localPort")
    }

    private fun stopUSBTransport() {
        isListening = false
        listenThread?.interrupt()
        listenThread = null
        serverSocket?.close()
        serverSocket = null

        // Disable USB tethering
        disableUsbTethering()

        Log.d(TAG, "USB transport stopped")
    }

    private fun enableUsbTethering() {
        // Enable USB tethering via ConnectivityManager
        // Note: This requires the device to support USB tethering
        try {
            val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE)
            val method = connectivityManager::class.java.getMethod("setUsbTethering", Boolean::class.java)
            method.invoke(connectivityManager, true)
        } catch (e: Exception) {
            Log.w(TAG, "USB tethering not available: ${e.message}")
        }
    }

    private fun disableUsbTethering() {
        try {
            val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE)
            val method = connectivityManager::class.java.getMethod("setUsbTethering", Boolean::class.java)
            method.invoke(connectivityManager, false)
        } catch (e: Exception) {
            Log.w(TAG, "Failed to disable USB tethering: ${e.message}")
        }
    }

    // Send control command to computer via USB
    fun sendCommand(data: ByteArray) {
        // TODO: Implement sending data back to computer over USB
        // Would use the reverse ADB tunnel or USB tethering network interface
    }

    override fun onDestroy() {
        stopUSBTransport()
        super.onDestroy()
    }
}
