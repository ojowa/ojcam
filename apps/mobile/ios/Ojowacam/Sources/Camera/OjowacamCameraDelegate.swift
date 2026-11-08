//
//  OjowacamCameraDelegate.swift
//  Ojowacam
//

import AVFoundation

extension OjowacamCameraModule: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard isStreaming, let encoder = videoEncoder else { return }

        encoder.encodeSampleBuffer(sampleBuffer)
    }
}
