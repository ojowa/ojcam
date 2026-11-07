#include "device-manager.h"

DeviceManager *DeviceManager::GetInstance()
{
    static DeviceManager instance;
    return &instance;
}

void DeviceManager::Initialize()
{
    // TODO: Start mDNS discovery for Ojowacam mobile devices
    // TODO: Start WebRTC signaling server for device pairing
}

void DeviceManager::Shutdown()
{
    std::lock_guard<std::mutex> lock(mutex_);
    devices_.clear();
}

std::vector<DiscoveredDevice> DeviceManager::GetDevices() const
{
    std::lock_guard<std::mutex> lock(mutex_);
    return devices_;
}

void DeviceManager::AddDevice(const DiscoveredDevice &device)
{
    std::lock_guard<std::mutex> lock(mutex_);
    devices_.push_back(device);
}

void DeviceManager::RemoveDevice(const std::string &device_id)
{
    std::lock_guard<std::mutex> lock(mutex_);
    devices_.erase(
        std::remove_if(devices_.begin(), devices_.end(),
                       [&](const DiscoveredDevice &d) { return d.device_id == device_id; }),
        devices_.end());
}
