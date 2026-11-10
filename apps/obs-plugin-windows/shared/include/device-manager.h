#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <functional>

namespace ojowacam {

struct DiscoveredDevice {
    std::string device_id;
    std::string device_name;
    std::string ip_address;
    int port;
    bool supports_video;
    bool supports_audio;
};

class DeviceManager {
public:
    using DeviceCallback = std::function<void(const DiscoveredDevice&)>;

    static DeviceManager *GetInstance();

    void Initialize();
    void Shutdown();

    std::vector<DiscoveredDevice> GetDevices() const;
    void AddDevice(const DiscoveredDevice &device);
    void RemoveDevice(const std::string &device_id);

    // Set a callback that fires whenever a new device is discovered
    void SetDeviceCallback(DeviceCallback cb);

    // Start/stop mDNS browsing explicitly
    void StartDiscovery();
    void StopDiscovery();

private:
    DeviceManager() = default;
    ~DeviceManager() = default;
    DeviceManager(const DeviceManager &) = delete;
    DeviceManager &operator=(const DeviceManager &) = delete;

    std::vector<DiscoveredDevice> devices_;
    mutable std::mutex mutex_;
    DeviceCallback device_cb_;

    // Platform-specific mDNS handle (opaque pointer)
    void* mdns_ref_ = nullptr;
    bool discovery_running_ = false;
};

} // namespace ojowacam