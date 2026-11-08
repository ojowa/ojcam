//
//  OjowacamWebRTCModule.swift
//  Ojowacam
//

import WebRTC
import React

@objc(OjowacamWebRTC)
class OjowacamWebRTCModule: RCTEventEmitter {

    private var peerConnectionFactory: PeerConnectionFactory?
    private var peerConnection: RTCPeerConnection?
    private var videoTrack: RTCVideoTrack?
    private var audioTrack: RTCAudioTrack?

    var onLocalSdp: ((String, String) -> Void)?
    var onIceCandidate: ((String) -> Void)?
    var onConnectionStateChange: ((String) -> Void)?

    override static func moduleName() -> String! {
        return "OjowacamWebRTC"
    }

    override func supportedEvents() -> [String]! {
        return ["onLocalSdp", "onIceCandidate", "onConnectionStateChange"]
    }

    override func constantsToExport() -> [AnyHashable: Any]! {
        return [:]
    }

    override func startObserving() {}
    override func stopObserving() {}

    @objc
    func initWebRTC(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        do {
            PeerConnectionFactory.initialize(
                encoderFactory: DefaultVideoEncoderFactory(),
                decoderFactory: DefaultVideoDecoderFactory()
            )

            let options = PeerConnectionFactory.Options()
            self.peerConnectionFactory = PeerConnectionFactory(options: options)

            resolve(true)
        } catch {
            reject("WEBRTC_INIT_ERROR", error.localizedDescription, error)
        }
    }

    @objc
    func createPeerConnection(_ iceServers: String, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard let factory = peerConnectionFactory else {
            reject("WEBRTC_NOT_INIT", "WebRTC not initialized", nil)
            return
        }

        let config = RTCConfiguration()
        config.iceServers = [RTCIceServer(urlStrings: [iceServers])]

        let constraints = RTCMediaConstraints(mandatoryConstraints: [
            "OfferToReceiveAudio": "true",
            "OfferToReceiveVideo": "false"
        ], optionalConstraints: nil)

        peerConnection = factory.peerConnection(with: config, constraints: constraints, delegate: self)

        resolve(true)
    }
    @objc
    func createOffer(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard let pc = peerConnection else {
            reject("WEBRTC_NO_PC", "No peer connection", nil)
            return
        }

        let constraints = RTCMediaConstraints(mandatoryConstraints: [
            "OfferToReceiveAudio": "true",
            "OfferToReceiveVideo": "false"
        ], optionalConstraints: nil)

        pc.offer(for: constraints) { [weak self] sdp, error in
            if let error = error {
                reject("WEBRTC_OFFER_ERROR", error.localizedDescription, error)
                return
            }

            guard let sdp = sdp else {
                reject("WEBRTC_OFFER_ERROR", "No SDP returned", nil)
                return
            }

            pc.setLocalDescription(sdp, completionHandler: { error in
                if let error = error {
                    reject("WEBRTC_SET_LOCAL_ERROR", error.localizedDescription, error)
                    return
                }

                self?.onLocalSdp?(sdp.type.rawValue, sdp.sdp)
                self?.sendEvent(withName: "onLocalSdp", body: [
                    "type": sdp.type.rawValue,
                    "sdp": sdp.sdp
                ])
                resolve(true)
            })
        }
    }

    @objc
    func setRemoteDescription(_ type: String, sdp: String, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard let pc = peerConnection else {
            reject("WEBRTC_NO_PC", "No peer connection", nil)
            return
        }

        let sessionDescription = RTCSessionDescription(
            type: RTCSdpType(rawValue: type),
            sdp: sdp
        )

        pc.setRemoteDescription(sessionDescription, completionHandler: { error in
            if let error = error {
                reject("REMOTE_SDP_ERROR", error.localizedDescription, error)
                return
            }
            resolve(true)
        })
    }

    @objc
    func addIceCandidate(_ candidate: String, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard let pc = peerConnection else {
            reject("WEBRTC_NO_PC", "No peer connection", nil)
            return
        }

        do {
            let iceCandidate = try RTCIceCandidate(sdp: candidate, sdpMLineIndex: 0, sdpMid: "0")
            pc.add(iceCandidate)
            resolve(true)
        } catch {
            reject("ICE_ERROR", error.localizedDescription, error)
        }
    }

    @objc
    func addVideoTrack(_ track: NSDictionary, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard let pc = peerConnection, let factory = peerConnectionFactory else {
            resolve(false)
            return
        }

        let videoSource = factory.videoSource()
        let videoTrack = factory.videoTrack(with: videoSource, trackId: "video0")

        pc.add(videoTrack, streamIds: ["stream0"])
        self.videoTrack = videoTrack

        resolve(true)
    }

    @objc
    func addAudioTrack(_ track: NSDictionary, resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        guard let pc = peerConnection, let factory = peerConnectionFactory else {
            resolve(false)
            return
        }

        let audioSource = factory.audioSource(with: RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil))
        let audioTrack = factory.audioTrack(with: audioSource, trackId: "audio0")

        pc.add(audioTrack, streamIds: ["stream0"])
        self.audioTrack = audioTrack

        resolve(true)
    }

    @objc
    func closeConnection(_ resolve: RCTPromiseResolveBlock, rejecter reject: RCTPromiseRejectBlock) {
        peerConnection?.close()
        peerConnection = nil
        videoTrack = nil
        audioTrack = nil
        resolve(true)
    }
}

extension OjowacamWebRTCModule: RTCPeerConnectionDelegate {
    func peerConnection(_ peerConnection: RTCPeerConnection, didGenerate candidate: RTCIceCandidate, url: String?) {
        onIceCandidate?(candidate.sdp)
        sendEvent(withName: "onIceCandidate", body: ["candidate": candidate.sdp])
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didChange state: RTCIceConnectionState) {
        let stateName = state.rawValue
        onConnectionStateChange?(stateName)
        sendEvent(withName: "onConnectionStateChange", body: ["state": stateName])
    }

    func peerConnection(_ peerConnection: RTCPeerConnection, didAdd stream: RTCMediaStream) {
        // Remote stream added
    }
}

