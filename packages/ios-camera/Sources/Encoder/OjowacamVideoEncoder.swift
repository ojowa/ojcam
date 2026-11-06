//
//  OjowacamVideoEncoder.swift
//

import VideoToolbox
import CoreMedia

class OjowacamVideoEncoder {
    private var compressionSession: VTCompressionSession?
    private var formatDescription: CMVideoFormatDescription?
    
    var onEncodedFrame: ((Data) -> Void)?
    
    init(width: Int, height: Int, bitrate: Int, fps: Int) {
        setupEncoder(width: width, height: height, bitrate: bitrate, fps: fps)
    }
    
    private func setupEncoder(width: Int, height: Int, bitrate: Int, fps: Int) {
        var formatDesc: CMVideoFormatDescription?
        CMVideoFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            codecType: kCMVideoCodecType_420YpCbCr8BiPlanarVideoRange,
            width: Int32(width),
            height: Int32(height),
            extensions: nil,
            formatDescriptionOut: &formatDesc
        )
        self.formatDescription = formatDesc
        
        var compressionSession: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            readyCallback: { (refcon, statusFlags, status, info, sampleBuffer) in
                guard let refcon = refcon else { return }
                let encoder = Unmanaged<OjowacamVideoEncoder>.fromOpaque(refcon).takeUnretainedValue()
                
                if status == noErr, let sampleBuffer = sampleBuffer {
                    if let dataBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) {
                        var length: Int = 0
                        var dataPointer: UnsafeMutablePointer<Int8>? = nil
                        CMBlockBufferGetDataPointer(dataBuffer, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &dataPointer)
                        
                        if let ptr = dataPointer, length > 0 {
                            let data = Data(bytes: ptr, count: length)
                            DispatchQueue.main.async {
                                encoder.onEncodedFrame?(data)
                            }
                        }
                    }
                }
            },
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            descriptor: formatDesc!,
            encoderSpecification: nil as CFString?,
            compressedOutput: nil,
            sessionOut: &compressionSession
        )
        
        guard status == noErr, let session = compressionSession else {
            print("Failed to create compression session: \(status)")
            return
        }
        
        self.compressionSession = session
        
        let properties: [String: Any] = [
            kVTCompressionPropertyKey_RealTime as String: true,
            kVTCompressionPropertyKey_AverageBitRate as String: bitrate,
            kVTCompressionPropertyKey_ProfileLevel as String: kVTProfileLevel_H264_High_AutoLevel,
            kVTCompressionPropertyKey_MaxKeyFrameInterval as String: fps * 2,
            kVTCompressionPropertyKey_AllowFrameReordering as String: false,
            kVTCompressionPropertyKey_ExpectedFrameRate as String: Double(fps)
        ]
        
        VTSessionSetProperties(session, propertyDictionary: properties as CFDictionary)
    }
    
    func encodeSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
        guard let session = compressionSession else { return }
        
        var frameDuration = CMTimeMake(value: 1, timescale: Int32(60))
        if let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer) {
            frameDuration = CMVideoFormatDescriptionGetDuration(formatDesc)
        }
        
        var timingInfo = CMSampleTimingInfo(
            duration: frameDuration,
            presentationTimeStamp: CMSampleBufferGetPresentationTimeStamp(sampleBuffer),
            decodeTimeStamp: CMSampleBufferGetDecodeTimeStamp(sampleBuffer)
        )
        
        var newSampleBuffer: CMSampleBuffer?
        CMSampleBufferCreateCopy(
            allocator: kCFAllocatorDefault,
            sampleBuffer: sampleBuffer,
            sampleBufferOut: &newSampleBuffer
        )
        
        if let buffer = newSampleBuffer {
            VTCompressionSessionEncodeFrame(
                session,
                sampleBuffer: buffer,
                frameDuration: frameDuration,
                frameFlags: [],
                sourceFrameRefcon: nil,
                infoFlagsOut: nil
            )
        }
    }
    
    deinit {
        if let session = compressionSession {
            VTCompressionSessionCompleteTasks(session, until: CMTime.zero)
            compressionSession = nil
        }
    }
}
