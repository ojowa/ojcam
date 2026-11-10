import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, StatusBar } from 'react-native';
import { CameraService } from '../native/modules';
import { streamingService } from '../services/StreamingService';
import { CameraDevice } from '../native/modules';

export default function CameraScreen() {
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [cameras, setCameras] = React.useState<CameraDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = React.useState<string>('back');
  const [torch, setTorch] = React.useState(false);

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
      const success = await streamingService.startStreaming(
        selectedCamera,
        {
          resolution: '1920x1080',
          fps: 30,
          bitrate: 8000000,
          codec: 'H264',
        },
        'ws://localhost:8080'
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
});
