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

    // Set a callback that fires whenever a phone beacon arrives. Clearing it
    // (nullptr) waits for any in-flight invocation, so the caller may safely
    // tear down whatever the callback captured afterwards.
    void SetDeviceCallback(DeviceCallback cb);

    // Backend entry point: records a device (latest entry for a phone wins,
    // so IP changes replace stale addresses) and fires the device callback.
    void HandleDiscovered(const DiscoveredDevice &device);

    // Start/stop discovery (UDP beacons always; mDNS additionally where the
    // platform provides it). Idempotent.
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
    // Held while a callback runs; cleared callbacks wait on it (drain) so a
    // listener can be destroyed without an in-flight call racing its death.
    mutable std::mutex invoke_mutex_;

    // Platform-specific mDNS handle (opaque pointer)
    void* mdns_ref_ = nullptr;
    // UDP beacon context (opaque pointer) — broadcasts this plugin's listen
    // port and receives the phone's beacons on the shared discovery port.
    void* udp_ref_ = nullptr;
    bool discovery_running_ = false;
};

} // namespace ojowacam