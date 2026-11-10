package com.ojowacam.mobile

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule

class WebRTCModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private val TAG = "OjowacamWebRTC"
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var videoTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null
    private var videoSource: VideoSource? = null
    private var audioSource: AudioSource? = null
    private var videoSink: VideoSink? = null

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
                reactApplicationContext,
                PeerConnectionFactory.InitializationOptions.builder(reactApplicationContext)
                    .setEnableVideoHwAcceleration(true)
                    .createInitializationOptions(),
                PeerConnectionFactory.Options(),
                JavaAudioDeviceModule.builder(reactApplicationContext)
                    .createAudioDeviceModule(),
                null
            )
            val options = PeerConnectionFactory.Options()
            val videoEncoderFactory = DefaultVideoEncoderFactory(
                reactApplicationContext,
                DefaultVideoEncoderFactory.CodecType.H264
            )
            val videoDecoderFactory = DefaultVideoDecoderFactory(reactApplicationContext)
            peerConnectionFactory = PeerConnectionFactory.builder()
                .setOptions(options)
                .setVideoEncoderFactory(videoEncoderFactory)
                .setVideoDecoderFactory(videoDecoderFactory)
                .createPeerConnectionFactory()
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WEBRTC_INIT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun createPeerConnection(iceServers: String, promise: Promise) {
        try {
            val server = PeerConnection.IceServer.builder(iceServers).createIceServer()
            val config = PeerConfiguration()
            config.iceServers.add(server)
            config.iceTransportsType = PeerConnection.IceTransportsType.ALL
            val pcConstraints = MediaConstraints()
            pcConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveAudio", "true"))
            pcConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveVideo", "false"))
            peerConnection = peerConnectionFactory!!.createPeerConnection(config, pcConstraints, object : PeerConnection.Observer {
                override fun onIceCandidate(iceCandidate: IceCandidate) {
                    emitIceCandidate(iceCandidate.sdp)
                }
                override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                    emitConnectionStateChange(newState.name)
                    Log.d(TAG, "ICE connection state: $newState")
                }
                override fun onAddStream(stream: MediaStream) {
                    Log.d(TAG, "Remote stream added")
                }
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
            val factory = peerConnectionFactory ?: throw Exception("WebRTC not initialized")
            videoSource = factory.createVideoSource(false)
            videoTrack = factory.createVideoTrack(trackId, videoSource!!)
            videoSink = object : VideoSink {
                override fun onFrame(frame: VideoFrame) {}
            }
            videoTrack!!.addSink(videoSink!!)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("VIDEO_TRACK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun createAudioTrack(trackId: String, promise: Promise) {
        try {
            val factory = peerConnectionFactory ?: throw Exception("WebRTC not initialized")
            audioSource = factory.createAudioSource(MediaConstraints())
            audioTrack = factory.createAudioTrack(trackId, audioSource!!)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("AUDIO_TRACK_ERROR", e.message, e)
        }
    }

    fun deliverVideoFrame(yuvData: ByteArray, timestampNs: Long, width: Int, height: Int) {
        val track = videoTrack ?: return
        val source = videoSource ?: return
        try {
            val yuvFrame = I420Frame(width, height)
            val ySize = width * height
            val uSize = (width / 2) * (height / 2)
            val vSize = uSize
            val yBuffer = ByteBuffer.wrap(yuvData, 0, ySize)
            val uBuffer = ByteBuffer.wrap(yuvData, ySize, uSize)
            val vBuffer = ByteBuffer.wrap(yuvData, ySize + uSize, vSize)
            yuvFrame.yData = yBuffer
            yuvFrame.uData = uBuffer
            yuvFrame.vData = vBuffer
            yuvFrame.yStride = width
            yuvFrame.uStride = width / 2
            yuvFrame.vStride = width / 2
            yuvFrame.timestampNs = timestampNs * 1000
            source.adaptFrame(yuvFrame, 0, 0)
            yuvFrame.release()
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
            if (videoTrack != null) {
                pc.addTrack(videoTrack!!, listOf("ojowacam-video"))
            }
            if (audioTrack != null) {
                pc.addTrack(audioTrack!!, listOf("ojowacam-audio"))
            }
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
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLOSE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addVideoTrack(trackId: String, promise: Promise) {
        try {
            val factory = peerConnectionFactory ?: throw Exception("WebRTC not initialized")
            videoSource = factory.createVideoSource(false)
            videoTrack = factory.createVideoTrack(trackId, videoSource!!)
            val pc = peerConnection ?: throw Exception("No peer connection")
            pc.addTrack(videoTrack!!, listOf("ojowacam-video"))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ADD_VIDEO_TRACK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addAudioTrack(trackId: String, promise: Promise) {
        try {
            val factory = peerConnectionFactory ?: throw Exception("WebRTC not initialized")
            audioSource = factory.createAudioSource(MediaConstraints())
            audioTrack = factory.createAudioTrack(trackId, audioSource!!)
            val pc = peerConnection ?: throw Exception("No peer connection")
            pc.addTrack(audioTrack!!, listOf("ojowacam-audio"))
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ADD_AUDIO_TRACK_ERROR", e.message, e)
        }
    }

    fun getPeerConnection(): PeerConnection? = peerConnection
    fun getVideoTrack(): VideoTrack? = videoTrack
    fun getAudioTrack(): AudioTrack? = audioTrack

    override fun onDestroy() {
        closeConnection(com.facebook.react.bridge.Promise() { _, _ -> })
        super.onDestroy()
    }

}

