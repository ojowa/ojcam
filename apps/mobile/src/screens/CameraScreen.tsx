import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, PermissionsAndroid, Platform, useWindowDimensions, SafeAreaView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Camera, CameraType, FlashMode } from 'expo-camera';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as ScreenOrientation from 'expo-screen-orientation';
import * as Network from 'expo-network';
import { CameraService } from '../native/modules';
import { streamingService } from '../services/StreamingService';
import { CameraDevice } from '../native/modules';
import { streamSettings } from '../services/config/StreamSettings';
import { connectionConfig } from '../services/config/ConnectionConfig';

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
  const navigation = useNavigation();
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
  const [qualityLabel, setQualityLabel] = React.useState('4K');
  const [qualityFps, setQualityFps] = React.useState(30);
  const [obsTarget, setObsTarget] = React.useState('');
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

  const requestPermissions = React.useCallback(async () => {
    // Runtime request for camera + mic (Android); iOS uses expo-camera prompts.
    const granted = await ensureCapturePermissions();
    const result = await Camera.requestCameraPermissionsAsync();
    setPermission(granted && result.granted);
  }, []);

  React.useEffect(() => {
    void requestPermissions();
  }, [requestPermissions]);

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

  const refreshSettingsDisplay = React.useCallback(async () => {
    await streamSettings.load();
    await connectionConfig.load();
    setQualityLabel(streamSettings.getResolutionLabel());
    setQualityFps(streamSettings.getFps());
    try {
      const ip = await Network.getIpAddressAsync();
      const url = connectionConfig.getSignalingUrl();
      setObsTarget(ip && ip !== '0.0.0.0' ? url.replace('0.0.0.0', ip) : url);
    } catch {
      setObsTarget(connectionConfig.getSignalingUrl());
    }
  }, []);

  // Re-read preferences when returning from the Settings screen.
  useFocusEffect(
    React.useCallback(() => {
      void refreshSettingsDisplay();
    }, [refreshSettingsDisplay]),
  );

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
      await streamSettings.load();
      // Uses ConnectionConfig signaling URL — never hardcode localhost.
      const success = await streamingService.startStreaming(
        selectedCamera,
        {
          resolution: streamSettings.getResolution(),
          fps: streamSettings.getFps(),
          bitrate: streamSettings.getBitrate(),
          codec: 'H264',
          audio: streamSettings.isAudioEnabled(),
        },
      );
      if (success) {
        setIsStreaming(true);
        // Native focus mode only takes effect once capture owns the camera.
        void CameraService.setFocusMode(streamSettings.isAutoFocus() ? 'continuousAutoFocus' : 'locked');
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

  if (permission === null) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.loadingText}>Loading permissions...</Text>
        <StatusBar style="light" />
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <Text style={styles.permissionSubtitle}>
          Ojowacam needs access to your camera to stream feed directly to OBS.
        </Text>
        <TouchableOpacity style={styles.primaryButton} onPress={() => void requestPermissions()}>
          <Text style={styles.primaryButtonText}>Grant Permission</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.goBack()}>
          <Text style={styles.secondaryButtonText}>Back to Home</Text>
        </TouchableOpacity>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.preview}>
        {nativeCapture ? (
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
        {!previewReady && !nativeCapture ? (
          <View style={styles.previewOverlay}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.previewText}>Starting camera…</Text>
          </View>
        ) : null}
      </View>

      <SafeAreaView style={[styles.topBar, isLandscape && styles.topBarLandscape]} pointerEvents="box-none">
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
          <Text style={styles.iconButtonText}>✕</Text>
        </TouchableOpacity>

        <View style={[styles.statusBadge, isStreaming ? styles.streamingBadge : styles.standbyBadge]}>
          <View style={[styles.statusDot, isStreaming ? styles.liveDot : styles.standbyDot]} />
          <Text style={styles.statusText}>{isStreaming ? 'LIVE TO OBS' : 'STANDBY'}</Text>
        </View>

        <View style={styles.topActions}>
          <TouchableOpacity style={styles.iconButton} onPress={() => void toggleOrientation()}>
            <Text style={styles.iconButtonText}>⟳</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconButton} onPress={loadCameras}>
            <Text style={styles.iconButtonText}>↻</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <View style={[styles.infoCard, isLandscape && styles.infoCardLandscape]} pointerEvents="none">
        <Text style={styles.infoLabel}>OUT: {qualityLabel} @ {qualityFps}fps</Text>
        <Text style={styles.infoValue}>OBS Target: {obsTarget || 'ws://…'}</Text>
      </View>

      {streamError ? (
        <View style={[styles.errorBanner, isLandscape && styles.errorBannerLandscape]}>
          <Text style={styles.errorText}>{streamError}</Text>
        </View>
      ) : null}

      <View style={[styles.bottomBar, isLandscape && styles.bottomBarLandscape]}>
        <TouchableOpacity style={styles.controlButton} onPress={() => setTorch(!torch)}>
          <Text style={styles.controlIcon}>{torch ? '⚡' : '🔌'}</Text>
          <Text style={styles.controlText}>Flash</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.streamButton, isStreaming ? styles.stopButton : styles.goLiveButton]}
          onPress={() => void toggleStreaming()}
        >
          <Text style={styles.streamButtonText}>{isStreaming ? 'Stop Stream' : 'Go Live'}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlButton} onPress={toggleFacing}>
          <Text style={styles.controlIcon}>🔄</Text>
          <Text style={styles.controlText}>Flip</Text>
        </TouchableOpacity>
      </View>

      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  centerContainer: {
    flex: 1,
    backgroundColor: '#0f1117',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#fff',
    fontSize: 16,
  },
  permissionTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  permissionSubtitle: {
    fontSize: 15,
    color: '#8e93a0',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  primaryButton: {
    backgroundColor: '#0a84ff',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    marginBottom: 12,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryButton: {
    backgroundColor: '#1c212e',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 32,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d3548',
  },
  secondaryButtonText: {
    color: '#f0f2f5',
    fontSize: 16,
    fontWeight: '600',
  },
  preview: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  previewText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 12,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    zIndex: 10,
  },
  topBarLandscape: {
    paddingTop: 6,
  },
  topActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  iconButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  standbyBadge: {
    backgroundColor: 'rgba(28, 33, 46, 0.8)',
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  streamingBadge: {
    backgroundColor: 'rgba(235, 87, 87, 0.2)',
    borderColor: 'rgba(235, 87, 87, 0.4)',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  standbyDot: {
    backgroundColor: '#8e93a0',
  },
  liveDot: {
    backgroundColor: '#eb5757',
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  infoCard: {
    position: 'absolute',
    top: 72,
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 17, 23, 0.75)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    alignItems: 'center',
    zIndex: 10,
  },
  infoCardLandscape: {
    top: 56,
  },
  infoLabel: {
    color: '#3fb950',
    fontSize: 12,
    fontWeight: '600',
  },
  infoValue: {
    color: '#8e93a0',
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  bottomBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 17, 23, 0.8)',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: 10,
  },
  bottomBarLandscape: {
    bottom: 8,
    paddingVertical: 10,
  },
  controlButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 60,
  },
  controlIcon: {
    fontSize: 20,
    marginBottom: 4,
  },
  controlText: {
    color: '#c9d1d9',
    fontSize: 11,
    fontWeight: '500',
  },
  streamButton: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 5,
  },
  goLiveButton: {
    backgroundColor: '#0a84ff',
  },
  stopButton: {
    backgroundColor: '#eb5757',
  },
  streamButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  errorBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 112,
    backgroundColor: 'rgba(235, 87, 87, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(235, 87, 87, 0.4)',
    borderRadius: 12,
    padding: 12,
    zIndex: 10,
  },
  errorBannerLandscape: {
    bottom: 92,
  },
  errorText: {
    color: '#ffb4ae',
    fontSize: 13,
    textAlign: 'center',
  },
});
