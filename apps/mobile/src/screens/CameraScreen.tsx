import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, PermissionsAndroid, Platform, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Camera, CameraType, FlashMode } from 'expo-camera';
import * as ScreenOrientation from 'expo-screen-orientation';
import { CameraService } from '../native/modules';
import { streamingService } from '../services/StreamingService';
import { CameraDevice } from '../native/modules';

/** Request Android runtime camera + microphone permissions. Returns true if granted (or non-Android). */
export async function ensureCapturePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    return (
      result[PermissionsAndroid.PERMISSIONS.CAMERA] === PermissionsAndroid.RESULTS.GRANTED &&
      result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] === PermissionsAndroid.RESULTS.GRANTED
    );
  } catch {
    return false;
  }
}

export default function CameraScreen() {
  const [isStreaming, setIsStreaming] = React.useState(false);
  /** True while native capture owns the camera (preview must stay unmounted). */
  const [nativeCapture, setNativeCapture] = React.useState(false);
  const [cameras, setCameras] = React.useState<CameraDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = React.useState<string>('0');
  const [facing, setFacing] = React.useState<'front' | 'back'>('back');
  const [torch, setTorch] = React.useState(false);
  const [orientation, setOrientation] = React.useState<'portrait' | 'landscape'>('portrait');
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [permission, setPermission] = React.useState<boolean | null>(null);
  const [previewReady, setPreviewReady] = React.useState(false);
  const cameraRef = React.useRef<Camera>(null);
  const startingRef = React.useRef(false);
  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Reflect the actual orientation on mount (the app starts unlocked).
  React.useEffect(() => {
    ScreenOrientation.getOrientationAsync()
      .then((o) => {
        const landscape =
          o === ScreenOrientation.Orientation.LANDSCAPE_LEFT ||
          o === ScreenOrientation.Orientation.LANDSCAPE_RIGHT;
        setOrientation(landscape ? 'landscape' : 'portrait');
      })
      .catch(() => undefined);
  }, []);

  const toggleOrientation = async () => {
    try {
      if (orientation === 'portrait') {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
        setOrientation('landscape');
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        setOrientation('portrait');
      }
    } catch (error) {
      console.warn('Unable to change orientation:', error);
    }
  };

  React.useEffect(() => {
    const handleState = (state: ReturnType<typeof streamingService.getState>) => {
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
      // Runtime request for camera + mic (Android); iOS uses expo-camera prompts.
      const granted = await ensureCapturePermissions();
      const result = await Camera.requestCameraPermissionsAsync();
      if (!cancelled) {
        setPermission(granted && result.granted);
      }
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
    // Ensure runtime camera/mic grants before native capture opens the camera.
    const granted = await ensureCapturePermissions();
    if (!granted) {
      setStreamError('Camera and microphone permissions are required to stream.');
      return;
    }
    setPermission(true);
    // Free the camera for the native capture module before streaming starts.
    setPreviewReady(false);
    setNativeCapture(true);
    startingRef.current = true;
    try {
      // Uses ConnectionConfig signaling URL — never hardcode localhost.
      const success = await streamingService.startStreaming(
        selectedCamera,
        {
          resolution: '3840x2160',
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

      <View style={[styles.controls, isLandscape && styles.controlsLandscape]}>
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

        <View style={[styles.row, isLandscape && styles.rowLandscape]}>
          <Text style={styles.label}>Camera: {selectedCamera} ({facing})</Text>
        </View>

        <View style={[styles.row, isLandscape && styles.rowLandscape]}>
          <TouchableOpacity style={[styles.controlButton, isLandscape && styles.controlButtonCompact]} onPress={toggleOrientation}>
            <Text>{orientation === 'portrait' ? 'Switch to Landscape' : 'Switch to Portrait'}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.row, isLandscape && styles.rowLandscape]}>
          <TouchableOpacity style={[styles.controlButton, isStreaming && styles.streamingButton]} onPress={toggleStreaming}>
            <Text>{isStreaming ? 'Stop Streaming' : 'Start Streaming'}</Text>
          </TouchableOpacity>
        </View>

        <View style={[styles.row, isLandscape && styles.rowLandscape]}>
          <Text style={styles.label}>Streaming: {isStreaming ? 'LIVE' : 'IDLE'}</Text>
        </View>

        {streamError ? (
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
  controlsLandscape: {
    padding: 10,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  rowLandscape: {
    marginBottom: 8,
  },
  controlButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 4,
  },
  controlButtonCompact: {
    padding: 10,
  },
  streamingButton: {
    backgroundColor: '#FF3B30',
  },
  label: {
    color: '#fff',
    fontSize: 16,
    marginBottom: 8,
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
