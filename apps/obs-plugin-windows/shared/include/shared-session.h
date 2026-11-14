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
 * OBS sources (video + microphone) each need frames from the same phone
 * session, but the phone's signaling server accepts a single active peer:
 * two independent connections would kick each other in an endless loop.
 * Sources therefore share one receiver: the first source creates and
 * connects it, later sources attach via setVideoSource/setAudioSource,
 * and the session lives until the last source releases its reference.
 */
class SharedSession {
public:
    static std::shared_ptr<StreamReceiver> acquire(const std::string& device_id,
                                                   const std::string& signaling_url);

private:
    static std::mutex& mutex();
    static std::map<std::string, std::weak_ptr<StreamReceiver>>& sessions();
};

} // namespace ojowacam
