#pragma once

#include <map>
#include <memory>
#include <mutex>
#include <string>

namespace ojowacam {

class StreamReceiver;

/**
 * Process-wide registry of StreamReceiver sessions.
 *
 * Each purpose gets its own receiver: the camera video source and the
 * Wireless Microphone source are independent sessions with independent
 * signaling connections, so one of them can work while the other is idle.
 * Sources of the same purpose share a receiver (e.g. two video sources in
 * different scenes) and attach to it via setVideoSource/setAudioSource.
 */
class SharedSession {
public:
    // signaling_url may be empty when auto_discover is on — the session then
    // keys on the purpose and forms once the phone is discovered on the
    // local network.
    // purpose distinguishes independent streams: "video" (camera) and
    // "mic" (Wireless Microphone).
    static std::shared_ptr<StreamReceiver> acquire(const std::string& device_id,
                                                   const std::string& signaling_url,
                                                   bool auto_discover = false,
                                                   const std::string& purpose = "video");

private:
    static std::mutex& mutex();
    static std::map<std::string, std::weak_ptr<StreamReceiver>>& sessions();
};

} // namespace ojowacam
