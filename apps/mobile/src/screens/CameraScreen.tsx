import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Camera, CameraType, FlashMode } from 'expo-camera';
import { CameraService } from '../native/modules';
import { streamingService } from '../services/StreamingService';
import { CameraDevice } from '../native/modules';

export default function CameraScreen() {
  const [isStreaming, setIsStreaming] = React.useState(false);
  /** True while native capture owns the camera (preview must stay unmounted). */
  const [nativeCapture, setNativeCapture] = React.useState(false);
  const [cameras, setCameras] = React.useState<CameraDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = React.useState<string>('0');
  const [facing, setFacing] = React.useState<'front' | 'back'>('back');
  const [torch, setTorch] = React.useState(false);
  const [pairingCode, setPairingCode] = React.useState<string | null>(null);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [permission, setPermission] = React.useState<boolean | null>(null);
  const [previewReady, setPreviewReady] = React.useState(false);
  const cameraRef = React.useRef<Camera>(null);
  const startingRef = React.useRef(false);

  React.useEffect(() => {
    const handleState = (state: ReturnType<typeof streamingService.getState>) => {
      setPairingCode(state.pairingCode);
      setStreamError(state.error);
      setIsStreaming(state.isStreaming);
      // Service stopped/failed outside this screen — release camera ownership.
      if (!state.isStreaming && !startingRef.current) {
        setNativeCapture(false);
      }
    };
    handleState(streamingService.getState());
    streamingService.setOnStateChange(handleState);
    return () => streamingService.setOnStateChange(() => undefined);
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await Camera.requestCameraPermissionsAsync();
      if (!cancelled) setPermission(result.granted);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadCameras = async () => {
    try {
      const available = await CameraService.getAvailableCameras();
      setCameras(available);
      if (available.length > 0) {
        setSelectedCamera(available[0].id);
        setFacing(available[0].facing === 'front' ? 'front' : 'back');
      }
    } catch (error) {
      console.warn('Failed to list cameras:', error);
    }
  };

  const toggleStreaming = async () => {
    if (nativeCapture || isStreaming) {
      startingRef.current = false;
      await streamingService.stopStreaming();
      setIsStreaming(false);
      setNativeCapture(false);
      setPreviewReady(false);
      return;
    }
    // Free the camera for the native capture module before streaming starts.
    setPreviewReady(false);
    setNativeCapture(true);
    startingRef.current = true;
    try {
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
      if (success) {
        setIsStreaming(true);
      } else {
        setNativeCapture(false);
        setIsStreaming(false);
      }
    } catch {
      setNativeCapture(false);
      setIsStreaming(false);
    } finally {
      startingRef.current = false;
    }
  };

  const toggleFacing = () => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    const next = cameras.find((c) => c.facing === (facing === 'back' ? 'front' : 'back'));
    if (next) setSelectedCamera(next.id);
  };

  React.useEffect(() => {
    loadCameras();
  }, []);

  const previewType: CameraType = facing === 'front' ? CameraType.front : CameraType.back;

  return (
    <View style={styles.container}>
      <View style={styles.preview}>
        {permission === false ? (
          <Text style={styles.previewText}>Camera permission denied</Text>
        ) : permission === null ? (
          <ActivityIndicator color="#fff" size="large" />
        ) : nativeCapture ? (
          // Native CameraModule owns the camera while streaming; preview would conflict.
          <Text style={styles.previewText}>Streaming live feed…</Text>
        ) : (
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            type={previewType}
            flashMode={torch ? FlashMode.torch : FlashMode.off}
            onCameraReady={() => setPreviewReady(true)}
            onMountError={(e) => console.warn('Camera mount error:', e.message)}
          />
        )}
        {isStreaming || nativeCapture ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
        ) : null}
        {!previewReady && permission === true && !nativeCapture ? (
          <View style={styles.previewOverlay}>
            <Text style={styles.previewText}>Starting camera…</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.controls}>
        <View style={styles.row}>
          <TouchableOpacity style={styles.controlButton} onPress={loadCameras}>
            <Text>Refresh Cameras</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlButton} onPress={toggleFacing}>
            <Text>Flip Camera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.controlButton} onPress={() => setTorch(!torch)}>
            <Text>{torch ? 'Torch On' : 'Torch Off'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>Camera: {selectedCamera} ({facing})</Text>
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
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  previewText: {
    color: '#fff',
    fontSize: 18,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  liveBadge: {
    position: 'absolute',
    top: 16,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#fff',
    marginRight: 6,
  },
  liveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
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
