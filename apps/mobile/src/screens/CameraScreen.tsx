import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraService } from '../native/modules';
import { streamingService } from '../services/StreamingService';
import { CameraDevice } from '../native/modules';

export default function CameraScreen() {
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [cameras, setCameras] = React.useState<CameraDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = React.useState<string>('back');
  const [torch, setTorch] = React.useState(false);
  const [pairingCode, setPairingCode] = React.useState<string | null>(null);
  const [streamError, setStreamError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const handleState = (state: ReturnType<typeof streamingService.getState>) => {
      setPairingCode(state.pairingCode);
      setStreamError(state.error);
      setIsStreaming(state.isStreaming);
    };
    handleState(streamingService.getState());
    streamingService.setOnStateChange(handleState);
    return () => streamingService.setOnStateChange(() => undefined);
  }, []);

  const loadCameras = async () => {
    const available = await CameraService.getAvailableCameras();
    setCameras(available);
    if (available.length > 0) {
      setSelectedCamera(available[0].id);
    }
  };

  const toggleStreaming = async () => {
    if (isStreaming) {
      await streamingService.stopStreaming();
      setIsStreaming(false);
    } else {
      // Uses ConnectionConfig signaling URL — never hardcode localhost.
      const success = await streamingService.startStreaming(
        selectedCamera,
        {
          resolution: '1920x1080',
          fps: 30,
          bitrate: 8000000,
          codec: 'H264',
        },
      );
      setIsStreaming(success);
    }
  };

  React.useEffect(() => {
    loadCameras();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.preview}>
        <Text style={styles.previewText}>Camera Preview</Text>
      </View>

      <View style={styles.controls}>
        <View style={styles.row}>
          <TouchableOpacity style={styles.controlButton} onPress={loadCameras}>
            <Text>Refresh Cameras</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlButton} onPress={() => setTorch(!torch)}>
            <Text>{torch ? 'Torch On' : 'Torch Off'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Camera: {selectedCamera}</Text>
        </View>

        <View style={styles.row}>
          <TouchableOpacity style={[styles.controlButton, isStreaming && styles.streamingButton]} onPress={toggleStreaming}>
            <Text>{isStreaming ? 'Stop Streaming' : 'Start Streaming'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Streaming: {isStreaming ? 'LIVE' : 'IDLE'}</Text>
        </View>

        {pairingCode ? (
          <View style={styles.pairingBanner}>
            <Text style={styles.pairingLabel}>Pairing code</Text>
            <Text style={styles.pairingCode}>{pairingCode}</Text>
            <Text style={styles.pairingHint}>Enter this code on your desktop to complete pairing</Text>
          </View>
        ) : null}

        {streamError && !pairingCode ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{streamError}</Text>
          </View>
        ) : null}
      </View>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  preview: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewText: {
    color: '#fff',
    fontSize: 18,
  },
  controls: {
    padding: 20,
    gap: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  controlButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
  },
  streamingButton: {
    backgroundColor: '#FF3B30',
  },
  label: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 8,
  },
  pairingBanner: {
    backgroundColor: 'rgba(0, 122, 255, 0.25)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  pairingLabel: {
    color: '#fff',
    fontSize: 13,
    opacity: 0.8,
    marginBottom: 4,
  },
  pairingCode: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 6,
    marginBottom: 6,
  },
  pairingHint: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.8,
    textAlign: 'center',
  },
  errorBanner: {
    backgroundColor: 'rgba(255, 59, 48, 0.25)',
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center',
  },
});
