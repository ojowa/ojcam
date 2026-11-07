#pragma once

#include <string>
#include <vector>
#include <mutex>

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
    static DeviceManager *GetInstance();

    void Initialize();
    void Shutdown();

    std::vector<DiscoveredDevice> GetDevices() const;
    void AddDevice(const DiscoveredDevice &device);
    void RemoveDevice(const std::string &device_id);

private:
    DeviceManager() = default;
    ~DeviceManager() = default;
    DeviceManager(const DeviceManager &) = delete;
    DeviceManager &operator=(const DeviceManager &) = delete;

    std::vector<DiscoveredDevice> devices_;
    mutable std::mutex mutex_;
};
