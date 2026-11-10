import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Switch, Alert, TextInput } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { USBService } from '../services/usb/USBService';
import { streamingService } from '../services/StreamingService';

export default function ConnectionScreen() {
  const [connectionMode, setConnectionMode] = React.useState<'wifi' | 'usb'>('wifi');
  const [usbDevices, setUSBDevices] = React.useState<Array<{id: string; name: string; type: string}>>([]);
  const [isUsbConnected, setIsUsbConnected] = React.useState(false);
  const [wifiStatus, setWifiStatus] = React.useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [pairingCode, setPairingCode] = React.useState<string | null>(null);
  const [pairingBusy, setPairingBusy] = React.useState(false);
  const [showCodeEntry, setShowCodeEntry] = React.useState(false);
  const [manualCode, setManualCode] = React.useState('');
  const [isPaired, setIsPaired] = React.useState(false);

  React.useEffect(() => {
    streamingService.setOnStateChange((state) => {
      setPairingCode(state.pairingCode);
      setIsPaired(state.isPaired);
    });
    const state = streamingService.getState();
    setPairingCode(state.pairingCode);
    setIsPaired(state.isPaired);
    return () => {
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
    setWifiStatus('connecting');
    setTimeout(() => {
      setWifiStatus('connected');
    }, 1500);
  };

  const disconnectWiFi = async () => {
    setWifiStatus('disconnected');
  };

  const handleShowPairing = async () => {
    if (pairingBusy) return;
    setPairingBusy(true);
    try {
      await streamingService.initialize();
      const code = await streamingService.requestPairing();
      Alert.alert(
        'Pairing Code',
        `Share this code with your desktop:\n\n${code}\n\nOr scan the QR payload from the desktop app once connected.`,
      );
    } catch (error) {
      Alert.alert('Pairing Failed', error instanceof Error ? error.message : 'Unable to start pairing.');
    } finally {
      setPairingBusy(false);
    }
  };

  const handleSubmitManualCode = async () => {
    if (pairingBusy) return;
    const code = manualCode.trim();
    if (!code) {
      Alert.alert('Missing Code', 'Enter the pairing code shown on your desktop.');
      return;
    }
    setPairingBusy(true);
    try {
      await streamingService.initialize();
      await streamingService.submitPairingCode(code);
      Alert.alert('Code Submitted', 'Waiting for the desktop to confirm pairing...');
      setShowCodeEntry(false);
      setManualCode('');
    } catch (error) {
      Alert.alert('Pairing Failed', error instanceof Error ? error.message : 'Unable to submit pairing code.');
    } finally {
      setPairingBusy(false);
    }
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
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, wifiStatus === 'connected' && styles.statusDotConnected]} />
            <Text>{wifiStatus === 'connected' ? 'Connected' : wifiStatus === 'connecting' ? 'Connecting...' : 'Disconnected'}</Text>
          </View>
          <TouchableOpacity style={styles.button} onPress={wifiStatus === 'connected' ? disconnectWiFi : connectWiFi}>
            <Text style={styles.buttonText}>{wifiStatus === 'connected' ? 'Disconnect Wi-Fi' : 'Connect Wi-Fi'}</Text>
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

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Pairing</Text>
        {isPaired ? (
          <View style={styles.pairedBanner}>
            <Text style={styles.pairedText}>Paired with desktop</Text>
          </View>
        ) : null}
        {pairingCode ? (
          <View style={styles.codeDisplay}>
            <Text style={styles.codeLabel}>Current code</Text>
            <Text style={styles.codeValue}>{pairingCode}</Text>
            <Text style={styles.codeHint}>Enter this code on the desktop, or scan the QR payload there.</Text>
          </View>
        ) : null}
        <TouchableOpacity
          style={[styles.button, pairingBusy && styles.buttonDisabled]}
          onPress={handleShowPairing}
          disabled={pairingBusy}
        >
          <Text style={styles.buttonText}>{pairingBusy ? 'Starting…' : 'Show Pairing Code'}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.buttonOutline}
          onPress={() => setShowCodeEntry((v) => !v)}
        >
          <Text style={styles.buttonText}>{showCodeEntry ? 'Hide Code Entry' : 'Enter Pairing Code'}</Text>
        </TouchableOpacity>
        {showCodeEntry ? (
          <View style={styles.codeEntry}>
            <TextInput
              style={styles.codeInput}
              value={manualCode}
              onChangeText={setManualCode}
              placeholder="6-digit code from desktop"
              placeholderTextColor="#999"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.button, pairingBusy && styles.buttonDisabled]}
              onPress={handleSubmitManualCode}
              disabled={pairingBusy}
            >
              <Text style={styles.buttonText}>Submit Code</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

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
  buttonOutline: {
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
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
  pairedBanner: {
    backgroundColor: '#e8f8ee',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  pairedText: {
    color: '#1a7f37',
    fontSize: 15,
    fontWeight: '600',
  },
  codeDisplay: {
    backgroundColor: '#f0f7ff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  codeLabel: {
    color: '#666',
    fontSize: 13,
    marginBottom: 4,
  },
  codeValue: {
    color: '#007AFF',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 6,
    marginBottom: 6,
  },
  codeHint: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
  },
  codeEntry: {
    marginTop: 4,
    gap: 8,
  },
  codeInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 20,
    letterSpacing: 4,
    textAlign: 'center',
    color: '#1a1a1a',
    backgroundColor: '#f9f9f9',
  },
});
