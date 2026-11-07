#include "device-manager.h"
#include <obs-module.h>
#include <thread>
#include <chrono>
#include <algorithm>
#include <cstring>

#if defined(__APPLE__) || defined(_WIN32)
    #include <dns_sd.h>
    #define OJO_MDNS_AVAILABLE 1
#elif defined(__linux__)
    #include <avahi-client/client.h>
    #include <avahi-client/lookup.h>
    #include <avahi-common/simple-watch.h>
    #include <avahi-common/error.h>
    #define OJO_MDNS_AVAILABLE 1
#endif

namespace {

std::string makeDeviceId(const std::string& name, const std::string& ip) {
    std::string id = name;
    if (!ip.empty()) id += "@" + ip;
    return id;
}
// ===========================================================================
// Bonjour implementation (macOS, Windows)
// ===========================================================================
#if defined(OJO_MDNS_AVAILABLE) && defined(__APPLE__)

struct BonjourContext {
    DNSServiceRef sd_ref = nullptr;
    std::thread browse_thread;
    bool running = false;
    DeviceManager::DeviceCallback callback;
};

static void DNSSD_API browseCallback(
    DNSServiceRef sd_ref,
    DNSServiceFlags flags,
    uint32_t interface_index,
    DNSServiceErrorType error_code,
    const char* service_name,
    const char* reg_type,
    const char* reply_domain,
    void* context) {

    (void)sd_ref; (void)flags; (void)interface_index; (void)reply_domain;
    if (error_code != kDNSServiceErr_NoError) {
        blog(LOG_WARNING, "[Ojowacam] mDNS browse error: %d", error_code);
        return;
    }

    auto* ctx = static_cast<BonjourContext*>(context);
    if (!ctx || !ctx->running) return;

    DNSServiceRef resolve_ref = nullptr;
    DNSServiceErrorType err = DNSServiceResolve(&resolve_ref,
        0, interface_index, service_name, reg_type, reply_domain,
        [](DNSServiceRef, DNSServiceFlags, uint32_t,
           DNSServiceErrorType err_code,
           const char* target, uint16_t port, uint16_t,
           const char*, void* ctx) {
            (void)err_code;
            auto* bonjour_ctx = static_cast<BonjourContext*>(ctx);
            if (!bonjour_ctx || !bonjour_ctx->running) return;

            int port = ntohs(port);
            DiscoveredDevice dev;
            dev.device_name = target ? target : "Ojowacam Device";
            dev.device_id = makeDeviceId(dev.device_name, target ? target : "");
            dev.ip_address = target ? target : "";
            dev.port = port;
            dev.supports_video = true;
            dev.supports_audio = true;

            blog(LOG_INFO, "[Ojowacam] Bonjour discovered: %s@%s:%d",
                 dev.device_name.c_str(), dev.ip_address.c_str(), dev.port);

            if (bonjour_ctx->callback) {
                bonjour_ctx->callback(dev);
            }
        },
        ctx);

    if (resolve_ref) {
        DNSServiceRefDeallocate(resolve_ref);
    }
}

void StartBonjourDiscovery(BonjourContext* ctx) {
    DNSServiceErrorType err = DNSServiceBrowse(&ctx->sd_ref,
        0, 0, kOjowacamServiceType, nullptr,
        browseCallback, ctx);

    if (err != kDNSServiceErr_NoError) {
        blog(LOG_ERROR, "[Ojowacam] Bonjour browse failed: %d", err);
        return;
    }

    while (ctx->running) {
        int fd = DNSServiceRefSockFD(ctx->sd_ref);
        if (fd < 0) break;

        fd_set readfds;
        FD_ZERO(&readfds);
        FD_SET(fd, &readfds);

        struct timeval tv;
        tv.tv_sec = 1;
        tv.tv_usec = 0;

        int result = select(fd + 1, &readfds, nullptr, nullptr, &tv);
        if (result > 0) {
// ===========================================================================
// Avahi implementation (Linux)
// ===========================================================================
#elif defined(OJO_MDNS_AVAILABLE) && defined(__linux__)

struct AvahiContext {
    AvahiClient* client = nullptr;
    AvahiServiceBrowser* browser = nullptr;
    AvahiSimplePoll* poll = nullptr;
    std::thread poll_thread;
    bool running = false;
    DeviceManager::DeviceCallback callback;
};

static void AvahiServiceBrowserCallback(
    AvahiServiceBrowser* browser,
    AvahiIfIndex, AvahiProtocol,
    AvahiBrowserEvent event,
    const char* name,
    const char* type,
    const char* domain,
    AvahiLookupResultFlags,
    void* userdata) {

    (void)browser; (void)type; (void)domain;

    auto* ctx = static_cast<AvahiContext*>(userdata);
    if (!ctx || !ctx->running) return;

    if (event == AVAHI_BROWSER_NEW) {
        AvahiServiceResolver* resolver = avahi_service_resolver_new(
            ctx->client, 0, AVAHI_PROTO_UNSPEC, name, type, domain,
            AVAHI_PROTO_UNSPEC, 0,
            [](AvahiServiceResolver* r,
               AvahiIfIndex, AvahiProtocol,
               AvahiResolverEvent event,
               const char* name,
               const char* type,
               const char* domain,
               const char* host_name,
               const AvahiAddress* address,
               uint16_t port,
               AvahiStringList*,
               AvahiLookupResultFlags,
               void* userdata) {

                (void)type; (void)domain;

                auto* ctx = static_cast<AvahiContext*>(userdata);
                if (!ctx || !ctx->running) return;

                if (event == AVAHI_RESOLVER_FOUND) {
                    char addr[AVAHI_ADDRESS_STR_MAX];
                    avahi_address_snprintf(addr, sizeof(addr), address);

                    DiscoveredDevice dev;
                    dev.device_name = host_name ? host_name : name ? name : "Ojowacam Device";
                    dev.device_id = makeDeviceId(dev.device_name, addr);
                    dev.ip_address = addr;
                    dev.port = static_cast<int>(port);
                    dev.supports_video = true;
                    dev.supports_audio = true;

                    blog(LOG_INFO, "[Ojowacam] Avahi discovered: %s@%s:%d",
                         dev.device_name.c_str(), dev.ip_address.c_str(), dev.port);

                    if (ctx->callback) {
                        ctx->callback(dev);
                    }
                }

                avahi_service_resolver_free(r);
            },
            ctx);

        (void)resolver;
    } else if (event == AVAHI_BROWSER_REMOVE) {
        blog(LOG_INFO, "[Ojowacam] Avahi device removed: %s", name ? name : "unknown");
    }
}

static void AvahiClientCallback(AvahiClient* client,
                                 AvahiClientState state,
                                 void* userdata) {

    auto* ctx = static_cast<AvahiContext*>(userdata);
    if (!ctx) return;

    if (state == AVAHI_CLIENT_S_RUNNING) {
        ctx->browser = avahi_service_browser_new(
            client, AVAHI_IF_UNSPEC, AVAHI_PROTO_UNSPEC,
            kOjowacamServiceType, nullptr, 0,
            AvahiServiceBrowserCallback, ctx);
    } else if (state == AVAHI_CLIENT_FAILURE) {
        blog(LOG_ERROR, "[Ojowacam] Avahi client failure");
        ctx->running = false;
    }
}

void StartAvahiDiscovery(AvahiContext* ctx) {
    int error = 0;
    ctx->poll = avahi_simple_poll_new();
    if (!ctx->poll) {
        blog(LOG_ERROR, "[Ojowacam] Avahi: failed to create simple poll");
        return;
    }

    ctx->client = avahi_client_new(
        avahi_simple_poll_get(ctx->poll),
        0,
        AvahiClientCallback,
        ctx,
        &error);

    if (!ctx->client) {
        blog(LOG_ERROR, "[Ojowacam] Avahi: failed to create client: %s",
             avahi_strerror(error));
        return;
    }

    while (ctx->running) {
        avahi_simple_poll_iterate(ctx->poll, 1000);
// ===========================================================================
// No mDNS fallback (platforms without Bonjour/Avahi)
// ===========================================================================
#else

struct NoMdnsContext {
    bool running = false;
    DeviceManager::DeviceCallback callback;
};

void StartNoMdnsDiscovery(NoMdnsContext* ctx) {
    blog(LOG_WARNING, "[Ojowacam] mDNS not available on this platform");
    ctx->running = false;
}

void StopNoMdnsDiscovery(NoMdnsContext* ctx) {
    ctx->running = false;
}
#endif  // OJO_MDNS_AVAILABLE

// ===========================================================================
// DeviceManager implementation
// ===========================================================================

namespace {

#if defined(OJO_MDNS_AVAILABLE) && defined(__APPLE__)
using MdnsContext = BonjourContext;
#elif defined(OJO_MDNS_AVAILABLE) && defined(__linux__)
using MdnsContext = AvahiContext;
#else
using MdnsContext = NoMdnsContext;
#endif

}

DeviceManager *DeviceManager::GetInstance() {
    static DeviceManager instance;
    return &instance;
}

void DeviceManager::Initialize() {
    blog(LOG_INFO, "[Ojowacam] Device manager initialized");
}

void DeviceManager::Shutdown() {
    StopDiscovery();
    std::lock_guard<std::mutex> lock(mutex_);
    devices_.clear();
}

std::vector<DiscoveredDevice> DeviceManager::GetDevices() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return devices_;
}

void DeviceManager::AddDevice(const DiscoveredDevice &device) {
    std::lock_guard<std::mutex> lock(mutex_);
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

void DeviceManager::SetDeviceCallback(DeviceCallback cb) {
    device_cb_ = std::move(cb);
}

void DeviceManager::StartDiscovery() {
    if (discovery_running_) return;

    mdns_ref_ = new MdnsContext();
    auto* ctx = static_cast<MdnsContext*>(mdns_ref_);
    ctx->running = true;
    ctx->callback = device_cb_;

    discovery_running_ = true;

#if defined(OJO_MDNS_AVAILABLE) && defined(__APPLE__)
    ctx->browse_thread = std::thread([ctx]() {
        StartBonjourDiscovery(ctx);
    });
#elif defined(OJO_MDNS_AVAILABLE) && defined(__linux__)
    ctx->poll_thread = std::thread([ctx]() {
        StartAvahiDiscovery(ctx);
    });
#else
    StartNoMdnsDiscovery(ctx);
#endif
}

void DeviceManager::StopDiscovery() {
    if (!discovery_running_) return;
    discovery_running_ = false;

    if (mdns_ref_) {
        auto* ctx = static_cast<MdnsContext*>(mdns_ref_);
        ctx->running = false;

#if defined(OJO_MDNS_AVAILABLE) && defined(__APPLE__)
        StopBonjourDiscovery(ctx);
#elif defined(OJO_MDNS_AVAILABLE) && defined(__linux__)
        StopAvahiDiscovery(ctx);
#else
        StopNoMdnsDiscovery(ctx);
#endif

        delete ctx;
        mdns_ref_ = nullptr;
    }
}
    }

    if (ctx->client) {
        avahi_client_free(ctx->client);
        ctx->client = nullptr;
    }
    if (ctx->poll) {
        avahi_simple_poll_free(ctx->poll);
        ctx->poll = nullptr;
    }
}

void StopAvahiDiscovery(AvahiContext* ctx) {
    ctx->running = false;
    if (ctx->poll) {
        avahi_simple_poll_quit(ctx->poll);
    }
    if (ctx->poll_thread.joinable()) {
        ctx->poll_thread.join();
    }
}
#endif  // __linux__
            DNSServiceProcessResult(ctx->sd_ref);
        }
    }

    if (ctx->sd_ref) {
        DNSServiceRefDeallocate(ctx->sd_ref);
        ctx->sd_ref = nullptr;
    }
}

void StopBonjourDiscovery(BonjourContext* ctx) {
    ctx->running = false;
    if (ctx->browse_thread.joinable()) {
        ctx->browse_thread.join();
    }
}
#endif  // __APPLE__

const char* kOjowacamServiceType = "_ojowacam._tcp";
const int kOjowacamServicePort = 8765;

} // namespace