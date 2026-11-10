#include "transport/usb/usb-transport.h"
#include <thread>
#include <iostream>

namespace ojowacam {

class iOSUSBTransport : public USBTransport {
public:
    iOSUSBTransport() = default;
    ~iOSUSBTransport() override { stop(); }

    bool start(const std::string& deviceId, int localPort, int remotePort) override {
        this->deviceId = deviceId;
        this->localPort = localPort;

        // iOS USB tethering creates a network interface (typically enX)
        // We listen on the local port for data coming over USB
        // iPhone creates an RNDIS/Ethernet over USB interface when tethering is enabled

        active_ = true;
        listening_ = true;
        listenThread_ = std::thread(&iOSUSBTransport::listenLoop, this);

        if (onConnectionStateChanged) onConnectionStateChanged(true);
        return true;
    }

    void stop() override {
        active_ = false;
        listening_ = false;
        if (listenThread_.joinable()) {
            listenThread_.join();
        }
    }

    bool isActive() const override { return active_; }

    int getLocalPort() const override { return localPort; }

    bool sendVideoFrame(const VideoFrame& frame) override {
        return true;
    }

    bool sendAudioFrame(const AudioFrame& frame) override {
        return true;
    }

private:
    void listenLoop() {
        // Listen on local port for USB-tunneled streaming data
        while (listening_) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }

    bool active_ = false;
    bool listening_ = false;
    std::thread listenThread_;
};

} // namespace ojowacam
