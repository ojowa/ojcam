#pragma once

#include <string>
#include <vector>
#include <mutex>
#include <functional>
#include <cstdint>

namespace ojowacam {

struct DiscoveredDevice {
    std::string device_id;
    std::string device_name;
    std::string ip_address;
    int port;
    bool supports_video;
    bool supports_audio;
    // Steady-clock ms of the last UDP beacon for this device. 0 means the
    // device is not beacon-tracked (mDNS entries, manually added devices)
    // and never expires on its own.
    uint64_t last_seen_ms = 0;
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

    // Set the single discovery callback (replaces all; nullptr clears all and
    // drains in-flight invocations). Prefer AddDeviceCallback/RemoveDeviceCallback
    // when several listeners (e.g. video + Wireless Microphone receivers) each
    // need to react to beacons.
    void SetDeviceCallback(DeviceCallback cb);
    uint64_t AddDeviceCallback(DeviceCallback cb);
    void RemoveDeviceCallback(uint64_t id);

    // Backend entry point: records a device (latest entry for a phone wins,
    // so IP changes replace stale addresses) and fires the device callbacks.
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
    struct CallbackEntry { uint64_t id; DeviceCallback cb; };
    std::vector<CallbackEntry> device_cbs_;
    uint64_t next_cb_id_ = 0;
    // Held while callbacks run; clearing callbacks waits on it (drain) so a
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