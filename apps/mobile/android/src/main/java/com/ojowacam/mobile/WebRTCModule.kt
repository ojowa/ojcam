package com.ojowacam.mobile

import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import org.webrtc.*
import org.webrtc.audio.JavaAudioDeviceModule

class WebRTCModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val TAG = "OjowacamWebRTC"
    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var videoTrack: VideoTrack? = null
    private var audioTrack: AudioTrack? = null
    private var onLocalSdp: ((String, String) -> Unit)? = null
    private var onIceCandidate: ((String) -> Unit)? = null
    private var onConnectionStateChange: ((String) -> Unit)? = null

    override fun getName(): String = "OjowacamWebRTC"

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
            val config = PeerConnection.IceServer.builder(iceServers).createIceServer()
            val servers = listOf(config)

            val pcConstraints = MediaConstraints()
            pcConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveAudio", "true"))
            pcConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveVideo", "false"))

            peerConnection = peerConnectionFactory!!.createPeerConnection(
                servers,
                pcConstraints,
                object : PeerConnection.Observer {
                    override fun onIceCandidate(iceCandidate: IceCandidate) {
                        onIceCandidate?.invoke(iceCandidate.sdp)
                    }

                    override fun onIceConnectionChange(newState: PeerConnection.IceConnectionState) {
                        onConnectionStateChange?.invoke(newState.name)
                        Log.d(TAG, "ICE connection state: $newState")
                    }

                    override fun onAddStream(stream: MediaStream) {
                        Log.d(TAG, "Remote stream added")
                    }
                }
            )

            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("WEBRTC_PC_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun createOffer(promise: Promise) {
        val sdpConstraints = MediaConstraints()
        sdpConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveAudio", "true"))
        sdpConstraints.mandatory.add(MediaConstraints.KeyValue("OfferToReceiveVideo", "false"))

        peerConnection!!.createOffer(object : SdpObserver {
            override fun onCreateSuccess(sessionDescription: SessionDescription) {
                peerConnection!!.setLocalDescription(
                    object : SdpObserver {
                        override fun onCreateSuccess(s: SessionDescription) {}
                        override fun onSetSuccess() {}
                        override fun onSetFailure(s: String) {}
                        override fun onFailure(s: String) {}
                    },
                    sessionDescription
                )
                onLocalSdp?.invoke(sessionDescription.type.canonicalString(), sessionDescription.description)
            }

            override fun onSetSuccess() {}
            override fun onSetFailure(s: String) {}
            override fun onFailure(s: String) {}
        }, sdpConstraints)
        promise.resolve(true)
    }

    @ReactMethod
    fun setRemoteDescription(type: String, sdp: String, promise: Promise) {
        try {
            val sessionDescription = SessionDescription(
                SessionDescription.Type.fromCanonicalForm(type),
                sdp
            )
            peerConnection!!.setRemoteDescription(
                object : SdpObserver {
                    override fun onCreateSuccess(s: SessionDescription) {}
                    override fun onSetSuccess() {}
                    override fun onSetFailure(s: String) {}
                    override fun onFailure(s: String) {}
                },
                sessionDescription
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("REMOTE_SDP_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addIceCandidate(candidate: String, promise: Promise) {
        try {
            val iceCandidate = IceCandidate.create(candidate)
            peerConnection!!.addIceCandidate(iceCandidate)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ICE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addVideoTrack(track: VideoTrack, promise: Promise) {
        videoTrack = track
        peerConnection!!.addTrack(videoTrack, listOf("ojowacam-video"))
        promise.resolve(true)
    }

    @ReactMethod
    fun addAudioTrack(track: AudioTrack, promise: Promise) {
        audioTrack = track
        peerConnection!!.addTrack(audioTrack, listOf("ojowacam-audio"))
        promise.resolve(true)
    }

    @ReactMethod
    fun closeConnection(promise: Promise) {
        try {
            peerConnection?.close()
            peerConnection = null
            videoTrack = null
            audioTrack = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLOSE_ERROR", e.message, e)
        }
    }

    override fun onDestroy() {
        closeConnection(com.facebook.react.bridge.Promise() { _, _ -> })
        super.onDestroy()
    }
}
