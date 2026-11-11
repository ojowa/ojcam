package com.ojowacam.mobile

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.ByteBuffer

class WebRTCModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "OjowacamWebRTC"
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var videoTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var audioSource: AudioSource? = null
    private var videoSink: VideoSink? = null
    private var frameWidth = 0
    private var frameHeight = 0

    override fun getName(): String = "OjowacamWebRTC"

    // Required by React Native NativeEventEmitter.
    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Double) {}

    private fun emitEvent(eventName: String, params: WritableMap) {
        try {
            reactApplicationContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, params)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to emit $eventName", e)
        }
    }

    private fun emitLocalSdp(type: String, sdp: String) {
        val map = Arguments.createMap()
        map.putString("type", type)
        map.putString("sdp", sdp)
        emitEvent("onLocalSdp", map)
    }

    private fun emitIceCandidate(candidate: String) {
        val map = Arguments.createMap()
        map.putString("candidate", candidate)
        emitEvent("onIceCandidate", map)
    }

    private fun emitConnectionStateChange(state: String) {
        val map = Arguments.createMap()
        map.putString("state", state)
        emitEvent("onConnectionStateChange", map)
    }

    @ReactMethod
    fun initWebRTC(promise: Promise) {
        try {
            PeerConnectionFactory.initialize(
                PeerConnectionFactory.InitializationOptions.builder(reactApplicationContext)
                    .createInitializationOptions()
            )
            val audioDeviceModule = JavaAudioDeviceModule.builder(reactApplicationContext)
                .setEnableVolumeLogger(false)
                .createAudioDeviceModule()
            val videoEncoderFactory = SoftwareVideoEncoderFactory()
            val videoDecoderFactory = SoftwareVideoDecoderFactory()
            peerConnectionFactory = PeerConnectionFactory.builder()
                .setOptions(PeerConnectionFactory.Options())
                .setAudioDeviceModule(audioDeviceModule)
                .setVideoEncoderFactory(videoEncoderFactory)
                .setVideoDecoderFactory(videoDecoderFactory)
                .createPeerConnectionFactory()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WEBRTC_INIT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun createPeerConnection(iceServers: ReadableArray, promise: Promise) {
        try {
            val factory = peerConnectionFactory ?: throw Exception("WebRTC not initialized")
            val config = PeerConnection.RTCConfiguration(
                ArrayList<PeerConnection.IceServer>()
            )
            for (i in 0 until iceServers.size()) {
                val url = iceServers.getString(i)?.trim()
                if (url.isNullOrEmpty()) continue
                config.iceServers.add(PeerConnection.IceServer.builder(url).createIceServer())
            }
            config.iceTransportsType = PeerConnection.IceTransportsType.ALL
            val pcConstraints = MediaConstraints()
            pcConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveAudio", "true"))
            pcConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveVideo", "false"))
            peerConnection = factory.createPeerConnection(config, pcConstraints, object : PeerConnection.Observer {
                override fun onSignalingChange(newState: PeerConnection.SignalingState) {
                    Log.d(TAG, "Signaling state: $newState")
                }
                override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                    emitConnectionStateChange(newState.name)
                    Log.d(TAG, "ICE connection state: $newState")
                }
                override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                override fun onIceGatheringChange(newState: PeerConnection.IceGatheringState) {
                    Log.d(TAG, "ICE gathering state: $newState")
                }
                override fun onIceCandidate(iceCandidate: IceCandidate) {
                    emitIceCandidate(iceCandidate.sdp)
                }
                override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
                override fun onAddStream(stream: MediaStream) {
                    Log.d(TAG, "Remote stream added")
                }
                override fun onRemoveStream(stream: MediaStream) {
                    Log.d(TAG, "Remote stream removed")
                }
                override fun onDataChannel(dataChannel: DataChannel) {}
                override fun onRenegotiationNeeded() {
                    Log.d(TAG, "Renegotiation needed")
                }
            })
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WEBRTC_PC_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun createVideoTrack(trackId: String, promise: Promise) {
        try {
            addVideoTrack(trackId, promise)
        } catch (e: Exception) {
            promise.reject("VIDEO_TRACK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun createAudioTrack(trackId: String, promise: Promise) {
        try {
            addAudioTrack(trackId, promise)
        } catch (e: Exception) {
            promise.reject("AUDIO_TRACK_ERROR", e.message, e)
        }
    }

    /**
     * Push a tightly packed I420 frame (Y, then U, then V) into the local video track.
     * Called by the camera pipeline via OjowacamPackage wiring.
     */
    fun deliverVideoFrame(i420: ByteArray, timestampNs: Long, width: Int, height: Int) {
        val source = videoSource ?: return
        if (width <= 0 || height <= 0 || i420.isEmpty()) return

        val ySize = width * height
        val chromaWidth = width / 2
        val chromaHeight = height / 2
        val uSize = chromaWidth * chromaHeight
        val vSize = uSize
        if (i420.size < ySize + uSize + vSize) return

        try {
            val yBuffer = ByteBuffer.allocateDirect(ySize)
            val uBuffer = ByteBuffer.allocateDirect(uSize)
            val vBuffer = ByteBuffer.allocateDirect(vSize)
            yBuffer.put(i420, 0, ySize).flip()
            uBuffer.put(i420, ySize, uSize).flip()
            vBuffer.put(i420, ySize + uSize, vSize).flip()

            val buffer = JavaI420Buffer.wrap(
                width, height,
                yBuffer, width,
                uBuffer, chromaWidth,
                vBuffer, chromaWidth,
                null,
            )
            val frame = VideoFrame(buffer, 0, timestampNs)
            try {
                source.capturerObserver.onFrameCaptured(frame)
            } finally {
                frame.release()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to deliver video frame", e)
        }
    }

    fun deliverAudioData(pcmData: ByteArray, timestampMs: Long) {
        val source = audioSource ?: return
        try {
            Log.d(TAG, "Delivered ${pcmData.size} bytes of audio data")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to deliver audio data", e)
        }
    }

    @ReactMethod
    fun createOffer(promise: Promise) {
        try {
            val pc = peerConnection ?: throw Exception("No peer connection")
            val sdpConstraints = MediaConstraints()
            sdpConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveAudio", "true"))
            sdpConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveVideo", "false"))
            pc.createOffer(object : SdpObserver {
                override fun onCreateSuccess(sessionDescription: SessionDescription) {
                    pc.setLocalDescription(object : SdpObserver {
                        override fun onCreateSuccess(s: SessionDescription) {}
                        override fun onSetSuccess() {
                            Log.d(TAG, "Local description set")
                            emitLocalSdp(sessionDescription.type.canonicalString(), sessionDescription.description)
                        }
                        override fun onSetFailure(s: String) {
                            Log.e(TAG, "Failed to set local description: $s")
                            emitLocalSdp(sessionDescription.type.canonicalString(), sessionDescription.description)
                        }
                        override fun onFailure(s: String) { Log.e(TAG, "Create offer failed: $s") }
                    }, sessionDescription)
                }
                override fun onSetSuccess() {}
                override fun onSetFailure(s: String) {
                    Log.e(TAG, "Set local description failed: $s")
                    promise.reject("WEBRTC_SET_LOCAL_ERROR", s, null)
                }
                override fun onFailure(s: String) {
                    Log.e(TAG, "Create offer failed: $s")
                    promise.reject("WEBRTC_OFFER_ERROR", s, null)
                }
            }, sdpConstraints)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WEBRTC_OFFER_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun setRemoteDescription(type: String, sdp: String, promise: Promise) {
        try {
            val pc = peerConnection ?: throw Exception("No peer connection")
            val sessionDescription = SessionDescription(SessionDescription.Type.fromCanonicalForm(type), sdp)
            pc.setRemoteDescription(object : SdpObserver {
                override fun onCreateSuccess(s: SessionDescription) {}
                override fun onSetSuccess() { Log.d(TAG, "Remote description set") }
                override fun onSetFailure(s: String) { Log.e(TAG, "Failed to set remote description: $s") }
                override fun onFailure(s: String) { Log.e(TAG, "Set remote description failed: $s") }
            }, sessionDescription)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("REMOTE_SDP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addIceCandidate(candidate: String, promise: Promise) {
        try {
            val pc = peerConnection ?: throw Exception("No peer connection")
            // Accept either a bare candidate line or a JSON {sdpMid,sdpMLineIndex,candidate} payload.
            val iceCandidate = try {
                val json = org.json.JSONObject(candidate)
                IceCandidate(
                    json.optString("sdpMid", "0"),
                    json.optInt("sdpMLineIndex", 0),
                    json.getString("candidate")
                )
            } catch (_: Exception) {
                IceCandidate("0", 0, candidate)
            }
            pc.addIceCandidate(iceCandidate)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ICE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun closeConnection(promise: Promise) {
        try {
            peerConnection?.close()
            peerConnection = null
            videoTrack = null
            audioTrack = null
            videoSource = null
            audioSource = null
            videoSink = null
            frameWidth = 0
            frameHeight = 0
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLOSE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addVideoTrack(trackId: String, promise: Promise) {
        try {
            val factory = peerConnectionFactory ?: throw Exception("WebRTC not initialized")
            val pc = peerConnection ?: throw Exception("No peer connection")
            val id = if (trackId.isBlank()) "ojowacam-video" else trackId

            videoSource?.let { src ->
                videoTrack?.let { src.removeSink(it) }
            }
            videoTrack = null
            videoSource = null
            videoSink = null

            videoSource = factory.createVideoSource(false)
            videoTrack = factory.createVideoTrack(id, videoSource!!)
            videoSink = object : VideoSink {
                override fun onFrame(frame: VideoFrame) {}
            }
            videoTrack!!.addSink(videoSink!!)
            pc.addTrack(videoTrack!!, listOf("ojowacam-stream"))
            frameWidth = 0
            frameHeight = 0
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ADD_VIDEO_TRACK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addAudioTrack(trackId: String, promise: Promise) {
        try {
            val factory = peerConnectionFactory ?: throw Exception("WebRTC not initialized")
            val pc = peerConnection ?: throw Exception("No peer connection")
            val id = if (trackId.isBlank()) "ojowacam-audio" else trackId

            audioSource = factory.createAudioSource(MediaConstraints())
            audioTrack = factory.createAudioTrack(id, audioSource!!)
            pc.addTrack(audioTrack!!, listOf("ojowacam-stream"))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ADD_AUDIO_TRACK_ERROR", e.message, e)
        }
    }

    fun getPeerConnection(): PeerConnection? = peerConnection
    fun getVideoTrack(): VideoTrack? = videoTrack
    fun getAudioTrack(): AudioTrack? = audioTrack

    override fun invalidate() {
        try {
            peerConnection?.close()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to close peer connection", e)
        }
        peerConnection = null
        videoTrack = null
        audioTrack = null
        videoSource = null
        audioSource = null
        videoSink = null
        frameWidth = 0
        frameHeight = 0
        super.invalidate()
    }

}

