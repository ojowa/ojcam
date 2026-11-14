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
    USBService.on('onUSBDisconnected', (data) => {
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
            <Text style={styles.statusText}>
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
                <Text style={styles.statusText}>Connected via USB</Text>
              </View>
              <TouchableOpacity style={[styles.button, styles.disconnectButton]} onPress={disconnectUSB}>
                <Text style={styles.buttonText}>Disconnect USB</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      <StatusBar style="light" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f1117',
    padding: 20,
  },
  card: {
    backgroundColor: '#161b22',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#212833',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#8e93a0',
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8e93a0',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 14,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 12,
  },
  optionRow: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#30363d',
    backgroundColor: '#0f1117',
  },
  selectedMode: {
    borderColor: '#0a84ff',
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
  },
  modeText: {
    fontSize: 15,
    color: '#8e93a0',
    fontWeight: '600',
  },
  modeTextSelected: {
    color: '#0a84ff',
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
  },
  statusText: {
    color: '#c9d1d9',
    fontSize: 15,
    fontWeight: '600',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#eb5757',
  },
  statusDotConnected: {
    backgroundColor: '#3fb950',
  },
  button: {
    backgroundColor: '#0a84ff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  disconnectButton: {
    backgroundColor: '#eb5757',
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
    borderBottomColor: '#212833',
  },
  usbDeviceName: {
    fontSize: 16,
    color: '#c9d1d9',
  },
  usbDeviceType: {
    fontSize: 14,
    color: '#8e93a0',
  },
  emptyText: {
    color: '#8e93a0',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  fieldLabel: {
    color: '#8e93a0',
    fontSize: 13,
    marginBottom: 6,
  },
  hostInput: {
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#fff',
    backgroundColor: '#0f1117',
    marginBottom: 6,
  },
  hostHint: {
    color: '#8e93a0',
    fontSize: 12,
    marginBottom: 8,
    lineHeight: 16,
  },
  hostUrl: {
    color: '#0a84ff',
    fontSize: 13,
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  connectionError: {
    color: '#ff7b72',
    fontSize: 13,
    marginBottom: 10,
  },
});
