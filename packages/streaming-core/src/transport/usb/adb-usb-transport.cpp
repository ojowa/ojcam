#include "usb/usb-transport.h"
#include <thread>
#include <chrono>
#include <cstdlib>
#include <iostream>

namespace ojowacam {

class ADBUSBTransport : public USBTransport {
public:
    ADBUSBTransport() = default;
    ~ADBUSBTransport() override { stop(); }

    bool start(const std::string& deviceId, int localPort, int remotePort) override {
        this->deviceId = deviceId;
        this->localPort = localPort;

        // ADB reverse: phone -> computer (reverse port forwarding)
        // adb -s <deviceId> reverse tcp:<remotePort> tcp:<localPort>
        std::string cmd = "adb -s " + deviceId + " reverse tcp:" +
                         std::to_string(remotePort) + " tcp:" +
                         std::to_string(localPort);

        int result = std::system(cmd.c_str());
        if (result != 0) {
            std::cerr << "ADB reverse failed: " << cmd << std::endl;
            return false;
        }

        // Start listening on local port for streaming data
        listening_ = true;
        listenThread_ = std::thread(&ADBUSBTransport::listenLoop, this);

        // Also try USB tethering as fallback
        enableUsbTethering();

        active_ = true;
        if (onConnectionStateChanged) onConnectionStateChanged(true);
        return true;
    }

    void stop() override {
        active_ = false;
        listening_ = false;
        if (listenThread_.joinable()) {
            listenThread_.join();
        }

        // Remove ADB reverse
        if (!deviceId.empty()) {
            std::string cmd = "adb -s " + deviceId + " reverse --remove tcp:" +
                             std::to_string(localPort);
            std::system(cmd.c_str());
        }
    }

    bool isActive() const override { return active_; }

    int getLocalPort() const override { return localPort; }

    bool sendVideoFrame(const VideoFrame& frame) override {
        // USB transport receives frames via the local port listener
        // This method is for sending control/commands back to phone
        return true;
    }

    bool sendAudioFrame(const AudioFrame& frame) override {
        return true;
    }

private:
    void listenLoop() {
        // TODO: Implement TCP server on localPort to receive streaming data
        // from the phone via ADB reverse tunnel
        while (listening_) {
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
    }

    void enableUsbTethering() {
        // Enable USB tethering on Android (requires root or specific permissions)
        // This creates a network interface on the computer
        std::string cmd = "adb -s " + deviceId + " shell svc usb setFunctions rndis,adb";
        std::system(cmd.c_str());
    }

    bool active_ = false;
    bool listening_ = false;
    std::thread listenThread_;
};

} // namespace ojowacam
