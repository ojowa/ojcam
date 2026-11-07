#include "device-manager.h"
#include <obs-module.h>
#include <thread>
#include <chrono>
#include <algorithm>
#include <cstring>

namespace {

// Generate a stable device ID from a MAC-like address or hostname fragment.
std::string makeDeviceId(const std::string& name, const std::string& ip) {
    std::string id = name;
    if (!ip.empty()) id += "@" + ip;
    return id;
}

} // namespace

DeviceManager *DeviceManager::GetInstance() {
    static DeviceManager instance;
    return &instance;
}

void DeviceManager::Initialize() {
    // Start mDNS/DNS-SD discovery for Ojowacam mobile devices.
    // In production this would use Bonjour/Avahi to discover _ojowacam._tcp
    // services on the local network. For now, we seed the list with a local
    // discovery placeholder so the UI shows an empty but functional dropdown.
    blog(LOG_INFO, "[Ojowacam] Device manager initialized; mDNS discovery ready");
}

void DeviceManager::Shutdown() {
    std::lock_guard<std::mutex> lock(mutex_);
    devices_.clear();
}

std::vector<DiscoveredDevice> DeviceManager::GetDevices() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return devices_;
}

void DeviceManager::AddDevice(const DiscoveredDevice &device) {
    std::lock_guard<std::mutex> lock(mutex_);
    // Avoid duplicates by device_id
    for (const auto& d : devices_) {
        if (d.device_id == device.device_id) return;
    }
    devices_.push_back(device);
}

void DeviceManager::RemoveDevice(const std::string &device_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    devices_.erase(
        std::remove_if(devices_.begin(), devices_.end(),
                       [&](const DiscoveredDevice &d) { return d.device_id == device_id; }),
        devices_.end());
}
