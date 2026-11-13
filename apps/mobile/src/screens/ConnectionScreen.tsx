import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Switch, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { USBService } from '../services/usb/USBService';
import { streamingService } from '../services/StreamingService';
import { connectionConfig } from '../services/config/ConnectionConfig';
import * as Network from 'expo-network';

export default function ConnectionScreen() {
  const [connectionMode, setConnectionMode] = React.useState<'wifi' | 'usb'>('wifi');
  const [usbDevices, setUSBDevices] = React.useState<Array<{id: string; name: string; type: string}>>([]);
  const [isUsbConnected, setIsUsbConnected] = React.useState(false);
  const [connecting, setConnecting] = React.useState(false);
  const [serverRunning, setServerRunning] = React.useState(false);
  const [peerConnected, setPeerConnected] = React.useState(false);
  const [localIp, setLocalIp] = React.useState('');
  const [signalingUrl, setSignalingUrl] = React.useState('');
  const [connectionError, setConnectionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const applyState = (state: ReturnType<typeof streamingService.getState>) => {
      if (cancelled) return;
      setPeerConnected(state.isConnected);
      if (state.isConnected) setConnectionError(null);
      else if (state.error) setConnectionError(state.error);
    };
    streamingService.setOnStateChange(applyState);
    applyState(streamingService.getState());
    void (async () => {
      await connectionConfig.load();
      if (cancelled) return;
      setSignalingUrl(connectionConfig.getSignalingUrl());
      try {
        const ip = await Network.getIpAddressAsync();
        if (!cancelled && ip && ip !== '0.0.0.0') setLocalIp(ip);
      } catch {
        // Leave blank if the IP cannot be determined.
      }
    })();
    return () => {
      cancelled = true;
      streamingService.setOnStateChange(() => undefined);
    };
  }, []);

  const loadUSBDevices = async () => {
    try {
      const devices = await USBService.getUSBDevices();
      setUSBDevices(devices.map(d => ({
        id: d.id,
        name: d.name,
        type: d.type
      })));
    } catch (error) {
      console.error('Failed to load USB devices:', error);
    }
  };

  const connectUSB = async (deviceId: string) => {
    try {
      const success = await USBService.startUSB(deviceId, 8080, 8081);
      setIsUsbConnected(success);
      if (success) {
        Alert.alert('USB Connected', 'Phone connected via USB to computer');
      }
    } catch (error) {
      Alert.alert('USB Connection Failed', error instanceof Error ? error.message : 'Unable to connect to the USB device.');
    }
  };

  const disconnectUSB = async () => {
    await USBService.stopUSB();
    setIsUsbConnected(false);
  };

  const connectWiFi = async () => {
    if (connecting || serverRunning) return;
    setConnecting(true);
    setConnectionError(null);
    try {
      const url = await streamingService.connectSignaling();
      setSignalingUrl(url);
      try {
        const ip = await Network.getIpAddressAsync();
        if (ip && ip !== '0.0.0.0') setLocalIp(ip);
      } catch {
        // Keep any previously fetched IP.
      }
      setServerRunning(true);
    } catch (error) {
      setServerRunning(false);
      const message = error instanceof Error ? error.message : 'Unable to start the signaling server.';
      setConnectionError(message);
      Alert.alert('Wi-Fi Connection Failed', message);
    } finally {
      setConnecting(false);
    }
  };

  const disconnectWiFi = async () => {
    await streamingService.disconnectSignaling();
    setServerRunning(false);
    setPeerConnected(false);
    setConnectionError(null);
  };

  React.useEffect(() => {
    loadUSBDevices();
    USBService.on('onUSBConnected', (data) => {
      setIsUsbConnected(true);
    });
    USBService.on('onUSBDisconnected', () => {
      setIsUsbConnected(false);
    });
  }, []);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Connection</Text>
        <Text style={styles.subtitle}>Connect your phone to OBS Studio</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Connection Mode</Text>
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.optionRow, connectionMode === 'wifi' && styles.selectedMode]}
            onPress={() => setConnectionMode('wifi')}
          >
            <Text style={[styles.modeText, connectionMode === 'wifi' && styles.modeTextSelected]}>
              Wi-Fi
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.optionRow, connectionMode === 'usb' && styles.selectedMode]}
            onPress={() => setConnectionMode('usb')}
          >
            <Text style={[styles.modeText, connectionMode === 'usb' && styles.modeTextSelected]}>
              USB
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {connectionMode === 'wifi' && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Wi-Fi Connection</Text>
          <Text style={styles.fieldLabel}>Phone address (set this in OBS)</Text>
          <Text style={styles.hostUrl}>
            {localIp && signalingUrl
              ? signalingUrl.replace('0.0.0.0', localIp)
              : signalingUrl || 'ws://0.0.0.0:8765'}
          </Text>
          <Text style={styles.hostHint}>
            The phone hosts the signaling server. Open the Ojowacam source in
            OBS Studio and enter the URL above, then connect here.
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, (serverRunning || peerConnected) && styles.statusDotConnected]} />
            <Text>
              {connecting
                ? 'Starting…'
                : peerConnected
                  ? 'Connected'
                  : serverRunning
                    ? 'Waiting for OBS…'
                    : 'Stopped'}
            </Text>
          </View>
          {connectionError && !peerConnected ? (
            <Text style={styles.connectionError}>{connectionError}</Text>
          ) : null}
          <TouchableOpacity
            style={[styles.button, connecting && styles.buttonDisabled]}
            onPress={serverRunning ? disconnectWiFi : connectWiFi}
            disabled={connecting}
          >
            <Text style={styles.buttonText}>
              {serverRunning ? 'Stop Server' : connecting ? 'Starting…' : 'Start Server'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {connectionMode === 'usb' && (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>USB Devices</Text>
            {usbDevices.length === 0 ? (
              <Text style={styles.emptyText}>No USB devices detected. Connect via USB cable.</Text>
            ) : (
              usbDevices.map((device) => (
                <TouchableOpacity
                  key={device.id}
                  style={styles.usbDeviceRow}
                  onPress={() => connectUSB(device.id)}
                >
                  <Text style={styles.usbDeviceName}>{device.name}</Text>
                  <Text style={styles.usbDeviceType}>{device.type}</Text>
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity style={styles.button} onPress={loadUSBDevices}>
              <Text style={styles.buttonText}>Refresh USB Devices</Text>
            </TouchableOpacity>
          </View>

          {isUsbConnected && (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>USB Status</Text>
              <View style={styles.statusRow}>
                <View style={styles.statusDotConnected} />
                <Text>Connected via USB</Text>
              </View>
              <TouchableOpacity style={[styles.button, styles.disconnectButton]} onPress={disconnectUSB}>
                <Text style={styles.buttonText}>Disconnect USB</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  optionRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
  },
  selectedMode: {
    borderColor: '#007AFF',
    backgroundColor: '#e8f4ff',
  },
  modeText: {
    fontSize: 16,
    color: '#666',
  },
  modeTextSelected: {
    color: '#007AFF',
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  statusDotConnected: {
    backgroundColor: '#34C759',
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  disconnectButton: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  usbDeviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  usbDeviceName: {
    fontSize: 16,
    color: '#1a1a1a',
  },
  usbDeviceType: {
    fontSize: 14,
    color: '#666',
  },
  emptyText: {
    color: '#999',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  fieldLabel: {
    color: '#666',
    fontSize: 13,
    marginBottom: 6,
  },
  hostInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a1a',
    backgroundColor: '#f9f9f9',
    marginBottom: 6,
  },
  hostHint: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
    lineHeight: 16,
  },
  hostUrl: {
    color: '#007AFF',
    fontSize: 12,
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  connectionError: {
    color: '#FF3B30',
    fontSize: 13,
    marginBottom: 10,
  },
});
