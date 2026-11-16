#pragma once

#include <map>
#include <memory>
#include <mutex>
#include <string>

namespace ojowacam {

class StreamReceiver;

/**
 * Process-wide registry of StreamReceiver sessions keyed by signaling URL.
 *
 * The camera video source and the Wireless Microphone source share one
 * receiver: both streams arrive over the same signaling connection (the
 * phone sends WebRTC media on the media track and raw mic PCM over WebSocket
 * binary frames). Two independent connections would kick each other in an
 * endless loop, so sources attach to one shared session via
 * setVideoSource/setAudioSource, and the session lives until the last source
 * releases its reference.
 */
class SharedSession {
public:
    // signaling_url may be empty when auto_discover is on — the session then
    // keys on "auto" and forms once the phone is discovered on the local
    // network.
    static std::shared_ptr<StreamReceiver> acquire(const std::string& device_id,
                                                   const std::string& signaling_url,
                                                   bool auto_discover = false);

private:
    static std::mutex& mutex();
    static std::map<std::string, std::weak_ptr<StreamReceiver>>& sessions();
};

} // namespace ojowacam
