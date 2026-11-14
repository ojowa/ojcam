#include "shared-session.h"
#include "stream-receiver.h"

#include <map>
#include <mutex>
#include <vector>

namespace ojowacam {

std::mutex& SharedSession::mutex() {
    static std::mutex m;
    return m;
}

std::map<std::string, std::weak_ptr<StreamReceiver>>& SharedSession::sessions() {
    static std::map<std::string, std::weak_ptr<StreamReceiver>> s;
    return s;
}

std::shared_ptr<StreamReceiver> SharedSession::acquire(const std::string& device_id,
                                                       const std::string& signaling_url,
                                                       bool auto_discover,
                                                       const std::string& purpose) {
    if (signaling_url.empty() && !auto_discover) return nullptr;

    std::lock_guard<std::mutex> lock(mutex());
    auto& registry = sessions();

    // Drop entries whose sources are all gone (weak_ptr expired).
    for (auto it = registry.begin(); it != registry.end();) {
        if (it->second.expired()) {
            it = registry.erase(it);
        } else {
            ++it;
        }
    }

    // Independent streams get independent receivers: the camera video source
    // and the Wireless Microphone source each own a signaling connection.
    // Sources of the same purpose share one receiver.
    const std::string purpose_key = purpose.empty() ? "video" : purpose;
    const std::string key =
        auto_discover ? ("auto:" + purpose_key) : (signaling_url + "#" + purpose_key);

    auto it = registry.find(key);
    if (it != registry.end()) {
        if (auto existing = it->second.lock()) {
            return existing;
        }
    }

    auto receiver = std::shared_ptr<StreamReceiver>(
        new StreamReceiver(nullptr, nullptr, purpose));
    receiver->connect(device_id, signaling_url, auto_discover);
    registry[key] = receiver;
    return receiver;
}

} // namespace ojowacam
