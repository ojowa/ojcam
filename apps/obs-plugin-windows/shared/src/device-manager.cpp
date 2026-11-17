#include "device-manager.h"
#include <transport/transport.h>
#include <obs-module.h>
#include <thread>
#include <chrono>
#include <atomic>
#include <algorithm>
#include <cstring>
#include <cstdlib>

#ifdef _WIN32
    #include <winsock2.h>
    #include <ws2tcpip.h>
    #pragma comment(lib, "ws2_32.lib")
    typedef int socklen_t;
    #define OJO_CLOSE_SOCKET(s) closesocket(s)
    using ojo_udp_socket_t = SOCKET;
    #define OJO_INVALID_UDP_SOCKET INVALID_SOCKET
#else
    #include <sys/socket.h>
    #include <netinet/in.h>
    #include <arpa/inet.h>
    #include <sys/time.h>
    #include <unistd.h>
    #define OJO_CLOSE_SOCKET(s) close(s)
    using ojo_udp_socket_t = int;
    #define OJO_INVALID_UDP_SOCKET (-1)
    // Winsock-only macros used by the shared beacon code paths.
    #ifndef SOCKET_ERROR
        #define SOCKET_ERROR (-1)
    #endif
#endif

#if defined(__APPLE__)
    #include <dns_sd.h>
    #define OJO_MDNS_AVAILABLE 1
    #define OJO_USE_BONJOUR 1
#elif defined(_WIN32)
    #if defined(__has_include)
        #if __has_include(<dns_sd.h>)
            #include <dns_sd.h>
            #define OJO_MDNS_AVAILABLE 1
            #define OJO_USE_BONJOUR 1
        #endif
    #endif
#elif defined(__linux__) && defined(OJO_HAVE_AVAHI)
    #include <avahi-client/client.h>
    #include <avahi-client/lookup.h>
    #include <avahi-common/simple-watch.h>
    #include <avahi-common/error.h>
    #define OJO_MDNS_AVAILABLE 1
    #define OJO_USE_AVAHI 1
#endif

namespace {

const char* kOjowacamServiceType = "_ojowacam._tcp";
const int kOjowacamServicePort = 8765;

std::string makeDeviceId(const std::string& name, const std::string& ip) {
    std::string id = name;
    if (!ip.empty()) id += "@" + ip;
    return id;
}

// ===========================================================================
// Bonjour implementation (macOS, Windows)
// ===========================================================================
#if defined(OJO_USE_BONJOUR)

struct BonjourContext {
    DNSServiceRef sd_ref = nullptr;
    std::thread browse_thread;
    bool running = false;
    ojowacam::DeviceManager* manager = nullptr;
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

            int resolved_port = ntohs(port);
            ojowacam::DiscoveredDevice dev;
            dev.device_name = target ? target : "Ojowacam Device";
            dev.device_id = makeDeviceId(dev.device_name, target ? target : "");
            dev.ip_address = target ? target : "";
            dev.port = resolved_port;
            dev.supports_video = true;
            dev.supports_audio = true;

            blog(LOG_INFO, "[Ojowacam] Bonjour discovered: %s@%s:%d",
                 dev.device_name.c_str(), dev.ip_address.c_str(), dev.port);

            if (bonjour_ctx->manager) {
                bonjour_ctx->manager->HandleDiscovered(dev);
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

// ===========================================================================
// Avahi implementation (Linux)
// ===========================================================================
#elif defined(OJO_USE_AVAHI)

struct AvahiContext {
    AvahiClient* client = nullptr;
    AvahiServiceBrowser* browser = nullptr;
    AvahiSimplePoll* poll = nullptr;
    std::thread poll_thread;
    bool running = false;
    ojowacam::DeviceManager* manager = nullptr;
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

                    ojowacam::DiscoveredDevice dev;
                    dev.device_name = host_name ? host_name : (name ? name : "Ojowacam Device");
                    dev.device_id = makeDeviceId(dev.device_name, addr);
                    dev.ip_address = addr;
                    dev.port = static_cast<int>(port);
                    dev.supports_video = true;
                    dev.supports_audio = true;

                    blog(LOG_INFO, "[Ojowacam] Avahi discovered: %s@%s:%d",
                         dev.device_name.c_str(), dev.ip_address.c_str(), dev.port);

                    if (ctx->manager) {
                        ctx->manager->HandleDiscovered(dev);
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

// ===========================================================================
// No mDNS fallback (platforms without Bonjour/Avahi)
// ===========================================================================
#else

struct NoMdnsContext {
    bool running = false;
    ojowacam::DeviceManager* manager = nullptr;
};

void StartNoMdnsDiscovery(NoMdnsContext* ctx) {
    blog(LOG_WARNING, "[Ojowacam] mDNS not available on this platform");
    ctx->running = false;
}

void StopNoMdnsDiscovery(NoMdnsContext* ctx) {
    ctx->running = false;
}

#endif  // mDNS backend selection

// ===========================================================================
// UDP beacon discovery — works on any shared network (LAN or phone hotspot)
// without mDNS support or manual IP entry.
//
// Both ends broadcast "OJOWACAM|1|role=<phone|obs>|ws=<port>[|id=<device>]"
// to 255.255.255.255:kDiscoveryUdpPort every 1.5 s. Receivers use the
// datagram's SOURCE address as the peer's current IP (payload IPs are never
// trusted); the optional id is the phone's stable identity so one phone
// keeps a single entry across IP changes and several phones on the same
// network stay distinct.
// ===========================================================================

struct UdpBeaconContext {
    ojo_udp_socket_t sock = OJO_INVALID_UDP_SOCKET;
    std::thread tx_thread;
    std::thread rx_thread;
    std::atomic<bool> running{false};
};

static bool ensureWinsock() {
#ifdef _WIN32
    static bool initialized = false;
    if (!initialized) {
        WSADATA wsa;
        if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return false;
        initialized = true;
    }
#endif
    return true;
}

// Parses "OJOWACAM|1|role=<r>|ws=<port>[|id=<device>]". Returns false on any
// malformed input; never reads past len.
static bool parseBeacon(const char* data, size_t len, std::string& role,
                        int& ws_port, std::string& device_id) {
    static const std::string magic = ojowacam::kBeaconMagic;
    std::string payload(data, len);
    if (payload.compare(0, magic.size(), magic) != 0) return false;
    if (payload.size() <= magic.size() || payload[magic.size()] != '|') return false;

    role.clear();
    ws_port = 0;
    device_id.clear();
    size_t pos = magic.size() + 1;
    while (pos < payload.size()) {
        size_t end = payload.find('|', pos);
        if (end == std::string::npos) end = payload.size();
        std::string field = payload.substr(pos, end - pos);
        size_t eq = field.find('=');
        if (eq != std::string::npos) {
            std::string key = field.substr(0, eq);
            std::string value = field.substr(eq + 1);
            if (key == "role") {
                role = value;
            } else if (key == "ws") {
                ws_port = std::atoi(value.c_str());
            } else if (key == "id") {
                // Stable per-install identity (capped defensively).
                device_id = value.substr(0, 64);
            }
        }
        pos = end + 1;
    }
    return !role.empty() && ws_port > 0 && ws_port <= 65535;
}

// Steady-clock milliseconds for beacon freshness bookkeeping.
static uint64_t NowMs() {
    return static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch())
            .count());
}

// Phones re-beacon every 1.5 s; this long without a beacon means the app
// closed or the phone left the network. Entries with last_seen_ms == 0
// (mDNS, manual) are not beacon-tracked and never expire here.
static constexpr uint64_t kBeaconTtlMs = 8000;

static bool IsBeaconDevice(const ojowacam::DiscoveredDevice& d) {
    return d.device_id.rfind("phone:", 0) == 0 ||
           d.device_id.rfind("phone@", 0) == 0;
}

static void startUdpBeacon(UdpBeaconContext* ctx, ojowacam::DeviceManager* manager) {
    if (!ensureWinsock()) {
        blog(LOG_ERROR, "[Ojowacam] UDP beacon: winsock init failed");
        return;
    }

    ctx->sock = socket(AF_INET, SOCK_DGRAM, 0);
    if (ctx->sock == OJO_INVALID_UDP_SOCKET) {
        blog(LOG_ERROR, "[Ojowacam] UDP beacon: socket() failed");
        return;
    }

    int on = 1;
    setsockopt(ctx->sock, SOL_SOCKET, SO_BROADCAST,
               reinterpret_cast<const char*>(&on), sizeof(on));
    setsockopt(ctx->sock, SOL_SOCKET, SO_REUSEADDR,
               reinterpret_cast<const char*>(&on), sizeof(on));

    sockaddr_in bind_addr{};
    bind_addr.sin_family = AF_INET;
    bind_addr.sin_port = htons(ojowacam::kDiscoveryUdpPort);
    bind_addr.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(ctx->sock, reinterpret_cast<sockaddr*>(&bind_addr), sizeof(bind_addr)) == SOCKET_ERROR) {
        blog(LOG_ERROR, "[Ojowacam] UDP beacon: bind(%u) failed", ojowacam::kDiscoveryUdpPort);
        OJO_CLOSE_SOCKET(ctx->sock);
        ctx->sock = OJO_INVALID_UDP_SOCKET;
        return;
    }

    // Receive timeout so the RX thread can observe ctx->running.
#ifdef _WIN32
    DWORD rcv_timeout = 1000;
    setsockopt(ctx->sock, SOL_SOCKET, SO_RCVTIMEO,
               reinterpret_cast<const char*>(&rcv_timeout), sizeof(rcv_timeout));
#else
    timeval rcv_timeout{1, 0};
    setsockopt(ctx->sock, SOL_SOCKET, SO_RCVTIMEO, &rcv_timeout, sizeof(rcv_timeout));
#endif

    ctx->rx_thread = std::thread([ctx, manager]() {
        char buf[512];
        while (ctx->running.load(std::memory_order_acquire)) {
            sockaddr_in src{};
            socklen_t src_len = sizeof(src);
            int n = static_cast<int>(recvfrom(ctx->sock, buf, sizeof(buf), 0,
                                              reinterpret_cast<sockaddr*>(&src), &src_len));
            if (n <= 0) {
                if (ctx->running.load(std::memory_order_acquire)) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(50));
                }
                continue;
            }
            std::string role;
            int ws_port = 0;
            std::string phone_id;
            if (!parseBeacon(buf, static_cast<size_t>(n), role, ws_port, phone_id)) continue;
            // Only the phone's beacons become devices here; the plugin
            // ignores its own broadcasts (they also loop back).
            if (role != "phone") continue;

            char ip_buf[INET_ADDRSTRLEN] = {0};
            if (!inet_ntop(AF_INET, &src.sin_addr, ip_buf, sizeof(ip_buf))) continue;

            ojowacam::DiscoveredDevice dev{};
            dev.ip_address = ip_buf;
            dev.port = ws_port;
            dev.device_name = "Ojowacam phone";
            // Key on the phone's stable id when the beacon carries one so
            // IP changes update the entry in place; fall back to the source
            // address for older phone builds.
            dev.device_id = phone_id.empty()
                ? (std::string("phone@") + ip_buf)
                : (std::string("phone:") + phone_id);
            dev.supports_video = true;
            dev.supports_audio = true;

            blog(LOG_INFO, "[Ojowacam] UDP beacon: phone at %s:%d",
                 dev.ip_address.c_str(), dev.port);
            manager->HandleDiscovered(dev);
        }
    });

    ctx->tx_thread = std::thread([ctx]() {
        const std::string beacon =
            std::string(ojowacam::kBeaconMagic) + "|role=obs|ws=" + std::to_string(ojowacam::kPluginWsPort);
        sockaddr_in dst{};
        dst.sin_family = AF_INET;
        dst.sin_port = htons(ojowacam::kDiscoveryUdpPort);
        dst.sin_addr.s_addr = htonl(INADDR_BROADCAST);
        while (ctx->running.load(std::memory_order_acquire)) {
            sendto(ctx->sock, beacon.c_str(), static_cast<int>(beacon.size()), 0,
                   reinterpret_cast<sockaddr*>(&dst), sizeof(dst));
            for (int i = 0; i < 15 && ctx->running.load(std::memory_order_acquire); ++i) {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
        }
    });
}

static void stopUdpBeacon(UdpBeaconContext* ctx) {
    ctx->running.store(false, std::memory_order_release);
    if (ctx->sock != OJO_INVALID_UDP_SOCKET) {
        // Closing unblocks a recvfrom waiting in the RX thread.
        OJO_CLOSE_SOCKET(ctx->sock);
        ctx->sock = OJO_INVALID_UDP_SOCKET;
    }
    if (ctx->tx_thread.joinable()) ctx->tx_thread.join();
    if (ctx->rx_thread.joinable()) ctx->rx_thread.join();
}

// ===========================================================================
// Platform context alias
// ===========================================================================
#if defined(OJO_USE_BONJOUR)
using MdnsContext = BonjourContext;
#elif defined(OJO_USE_AVAHI)
using MdnsContext = AvahiContext;
#else
using MdnsContext = NoMdnsContext;
#endif

} // namespace

namespace ojowacam {

// ===========================================================================
// DeviceManager implementation
// ===========================================================================

DeviceManager *DeviceManager::GetInstance() {
    static DeviceManager instance;
    return &instance;
}

void DeviceManager::Initialize() {
    blog(LOG_INFO, "[Ojowacam] Device manager initialized");
}

void DeviceManager::Shutdown() {
    StopDiscovery();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        devices_.clear();
    }
    SetDeviceCallback(nullptr); // also drains in-flight invocations
}

std::vector<ojowacam::DiscoveredDevice> DeviceManager::GetDevices() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<ojowacam::DiscoveredDevice> out;
    out.reserve(devices_.size());
    const uint64_t now = NowMs();
    for (const auto& d : devices_) {
        // Hide beacon-tracked phones that went silent; mDNS and manually
        // added devices (last_seen_ms == 0) are kept as-is.
        if (IsBeaconDevice(d) && d.last_seen_ms != 0 &&
            now - d.last_seen_ms > kBeaconTtlMs) {
            continue;
        }
        out.push_back(d);
    }
    return out;
}

void DeviceManager::AddDevice(const ojowacam::DiscoveredDevice &device) {
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
                       [&](const ojowacam::DiscoveredDevice &d) { return d.device_id == device_id; }),
        devices_.end());
}

void DeviceManager::SetDeviceCallback(DeviceCallback cb) {
    const bool clearing = !cb;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        device_cbs_.clear();
        if (cb) device_cbs_.push_back({next_cb_id_++, std::move(cb)});
    }
    if (clearing) {
        // Drain: block until any in-flight invocation finishes so the
        // callbacks' targets (the stream receivers) can be destroyed safely.
        std::lock_guard<std::mutex> drain(invoke_mutex_);
    }
}

uint64_t DeviceManager::AddDeviceCallback(DeviceCallback cb) {
    std::lock_guard<std::mutex> lock(mutex_);
    const uint64_t id = next_cb_id_++;
    device_cbs_.push_back({id, std::move(cb)});
    return id;
}

void DeviceManager::RemoveDeviceCallback(uint64_t id) {
    std::lock_guard<std::mutex> lock(mutex_);
    device_cbs_.erase(
        std::remove_if(device_cbs_.begin(), device_cbs_.end(),
                       [&](const CallbackEntry& e) { return e.id == id; }),
        device_cbs_.end());
}

void DeviceManager::HandleDiscovered(const DiscoveredDevice &device) {
    const uint64_t now = NowMs();
    {
        std::lock_guard<std::mutex> lock(mutex_);
        // One entry per device, keyed by its stable id: the latest beacon
        // refreshes the address in place (an IP change never duplicates the
        // phone) and other entries are never touched, so every phone on the
        // network stays listed side by side.
        bool present = false;
        for (auto& d : devices_) {
            if (d.device_id == device.device_id) {
                d = device;
                d.last_seen_ms = now;
                present = true;
                break;
            }
        }
        if (!present) {
            DiscoveredDevice entry = device;
            entry.last_seen_ms = now;
            devices_.push_back(entry);
        }
        // Opportunistically drop phones that stopped beaconing (they
        // re-announce every 1.5 s, so 8 s of silence means the app is gone).
        devices_.erase(
            std::remove_if(devices_.begin(), devices_.end(),
                           [&](const DiscoveredDevice& d) {
                               return IsBeaconDevice(d) && d.last_seen_ms != 0 &&
                                      now - d.last_seen_ms > kBeaconTtlMs;
                           }),
            devices_.end());
    }
    // Fire for every beacon (listeners gate themselves, e.g. "already
    // connected"), never while holding mutex_, and under invoke_mutex_ with a
    // re-check so a concurrent clear can neither race the call nor be missed.
    std::vector<DeviceCallback> cbs;
    {
        std::lock_guard<std::mutex> lock(mutex_);
        cbs.reserve(device_cbs_.size());
        for (const auto& e : device_cbs_) cbs.push_back(e.cb);
    }
    {
        std::lock_guard<std::mutex> invoke(invoke_mutex_);
        for (const auto& cb : cbs) {
            if (cb) cb(device);
        }
    }
}

void DeviceManager::StartDiscovery() {
    if (discovery_running_) return;

    discovery_running_ = true;

    // UDP beacons run on every platform: announce this plugin's WebSocket
    // port and receive the phone's beacons (any shared network, any IP).
    auto* udp = new UdpBeaconContext();
    udp->running.store(true, std::memory_order_release);
    udp_ref_ = udp;
    startUdpBeacon(udp, this);

    mdns_ref_ = new MdnsContext();
    auto* ctx = static_cast<MdnsContext*>(mdns_ref_);
    ctx->running = true;
    ctx->manager = this;

#if defined(OJO_USE_BONJOUR)
    ctx->browse_thread = std::thread([ctx]() {
        StartBonjourDiscovery(ctx);
    });
#elif defined(OJO_USE_AVAHI)
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

    if (udp_ref_) {
        auto* udp = static_cast<UdpBeaconContext*>(udp_ref_);
        stopUdpBeacon(udp);
        delete udp;
        udp_ref_ = nullptr;
    }

    if (mdns_ref_) {
        auto* ctx = static_cast<MdnsContext*>(mdns_ref_);
        ctx->running = false;

#if defined(OJO_USE_BONJOUR)
        StopBonjourDiscovery(ctx);
#elif defined(OJO_USE_AVAHI)
        StopAvahiDiscovery(ctx);
#else
        StopNoMdnsDiscovery(ctx);
#endif

        delete ctx;
        mdns_ref_ = nullptr;
    }
}

} // namespace ojowacam
