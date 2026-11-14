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
                                                       bool auto_discover) {
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

    // One phone on one network: manual URLs key on the URL, discovery
    // sessions key on the device so video + microphone still share.
    const std::string key =
        signaling_url.empty() ? ("auto:" + device_id) : signaling_url;

    auto it = registry.find(key);
    if (it != registry.end()) {
        if (auto existing = it->second.lock()) {
            return existing;
        }
    }

    auto receiver = std::shared_ptr<StreamReceiver>(new StreamReceiver(nullptr, nullptr));
    receiver->connect(device_id, signaling_url, auto_discover);
    registry[key] = receiver;
    return receiver;
}

} // namespace ojowacam
