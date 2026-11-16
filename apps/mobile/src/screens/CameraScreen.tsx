import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  useWindowDimensions,
  SafeAreaView,
  PanResponder,
} from 'react-native';
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

export type ZoomLevel = 1 | 2 | 3;
export type FocusMode = 'continuousAutoFocus' | 'locked' | 'autoFocus';
export type WhiteBalance = 'auto' | 'daylight' | 'cloudy' | 'tungsten' | 'fluorescent';

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

  // Digital camera controls
  const [zoomLevel, setZoomLevel] = React.useState<ZoomLevel>(1);
  const [focusMode, setFocusMode] = React.useState<FocusMode>('continuousAutoFocus');
  const [whiteBalance, setWhiteBalance] = React.useState<WhiteBalance>('auto');
  const [gridOverlay, setGridOverlay] = React.useState(false);
  const [timerActive, setTimerActive] = React.useState(false);
  const [timerSeconds, setTimerSeconds] = React.useState(3);
  const [focusPoint, setFocusPoint] = React.useState<{ x: number; y: number } | null>(null);
  const [isPinchZooming, setIsPinchZooming] = React.useState(false);
  const [pinchStartZoom, setPinchStartZoom] = React.useState<ZoomLevel>(1);

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  // Reflect the actual orientation on mount (used by the orientation lock toggle).
  // Layout responsiveness is driven by useWindowDimensions (isLandscape), which
  // updates automatically on rotation.
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

  // Digital camera: apply focus mode when it changes.
  React.useEffect(() => {
    if (!nativeCapture && !isStreaming) return;
    void CameraService.setFocusMode(focusMode).catch(() => undefined);
  }, [focusMode, nativeCapture, isStreaming]);

  // Digital camera: pinch-to-zoom responder for the preview.
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (_, gestureState) => {
          setIsPinchZooming(true);
          setPinchStartZoom(zoomLevel);
          if (focusPoint) setFocusPoint(null);
        },
        onPanResponderMove: (_, gestureState) => {
          // Vertical drag: cycle zoom levels 1 → 2 → 3 → 1
          if (Math.abs(gestureState.dy) > 40 && !isPinchZooming) {
            const next = (zoomLevel % 3) + 1 as ZoomLevel;
            setZoomLevel(next);
          }
        },
        onPanResponderRelease: () => {
          setIsPinchZooming(false);
        },
        onPanResponderTerminate: () => {
          setIsPinchZooming(false);
        },
      }),
    [zoomLevel, isPinchZooming]
  );

  // Tap to focus / expose on the preview.
  const handlePreviewPress = (event: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = event.nativeEvent;
    setFocusPoint({ x: locationX, y: locationY });
    // Auto-focus on tap (only meaningful when not streaming/native capture).
    if (!nativeCapture && !isStreaming) {
      void CameraService.setFocusMode('autoFocus').catch(() => undefined);
      setTimeout(() => void CameraService.setFocusMode(focusMode).catch(() => undefined), 1500);
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

  const toggleFacing = () => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    const next = cameras.find((c) => c.facing === (facing === 'back' ? 'front' : 'back'));
    if (next) setSelectedCamera(next.id);
  };

  const handleZoomChange = (level: ZoomLevel) => {
    setZoomLevel(level);
    setIsPinchZooming(false);
  };

  const handleFocusModeChange = (mode: FocusMode) => {
    setFocusMode(mode);
    void CameraService.setFocusMode(mode).catch(() => undefined);
  };

  const handleWhiteBalanceChange = (wb: WhiteBalance) => {
    setWhiteBalance(wb);
  };

  const toggleGrid = () => {
    setGridOverlay(!gridOverlay);
  };

  const startTimer = () => {
    if (timerActive) return;
    setTimerActive(true);
    setTimerSeconds(3);
    const interval = setInterval(() => {
      setTimerSeconds((s) => {
        if (s <= 1) {
          clearInterval(interval);
          setTimerActive(false);
          setFocusPoint(null);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
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
      {/* Camera preview with digital overlays */}
      <View style={styles.preview} {...panResponder.panHandlers}>
        {nativeCapture ? (
          // Native CameraModule owns the camera while streaming; preview would conflict.
          <View style={styles.streamingOverlay}>
            <Text style={styles.streamingText}>LIVE FEED — Streaming to OBS</Text>
            <Text style={styles.streamingSub}>{qualityLabel} @ {qualityFps}fps · {facing} camera</Text>
          </View>
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

        {/* Focus point indicator (tap to focus) */}
        {focusPoint && !nativeCapture && !isStreaming && (
          <View style={[styles.focusRing, { left: focusPoint.x - 30, top: focusPoint.y - 30 }]} />
        )}

        {/* Countdown timer overlay */}
        {timerActive && timerSeconds > 0 && (
          <View style={styles.timerOverlay}>
            <Text style={styles.timerText}>{timerSeconds}</Text>
          </View>
        )}

        {/* Grid overlay (rule of thirds) */}
        {gridOverlay && !nativeCapture && (
          <View style={styles.gridOverlay}>
            <View style={[styles.gridLine, styles.gridLineTop]} />
            <View style={[styles.gridLine, styles.gridLineBottom]} />
            <View style={[styles.gridLineV, styles.gridLineVLeft]} />
            <View style={[styles.gridLineV, styles.gridLineVRight]} />
          </View>
        )}

        {/* Zoom indicator */}
        {!nativeCapture && (
          <View style={[styles.zoomIndicator, isLandscape && styles.zoomIndicatorLandscape]}>
            <TouchableOpacity style={styles.zoomMinus} onPress={() => handleZoomChange(1)}>
              <Text style={styles.zoomText}>1×</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.zoomMinus} onPress={() => handleZoomChange(2)}>
              <Text style={[styles.zoomText, zoomLevel === 2 && styles.zoomActive]}>2×</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.zoomMinus} onPress={() => handleZoomChange(3)}>
              <Text style={[styles.zoomText, zoomLevel === 3 && styles.zoomActive]}>3×</Text>
            </TouchableOpacity>
          </View>
        )}
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

      <View
        style={[
          styles.infoCard,
          isLandscape
            ? { ...styles.infoCardLandscape, alignSelf: 'flex-start', left: 16, top: 12 }
            : {},
        ]}
        pointerEvents="none"
      >
        <Text style={styles.infoLabel}>OUT: {qualityLabel} @ {qualityFps}fps</Text>
        <Text style={styles.infoValue}>OBS Target: {obsTarget || 'ws://…'}</Text>
      </View>

      {streamError ? (
        <View style={[styles.errorBanner, isLandscape && styles.errorBannerLandscape]}>
          <Text style={styles.errorText}>{streamError}</Text>
        </View>
      ) : null}

      {/* Digital camera control bar. In landscape it becomes a vertical strip on
       * the right edge so the preview keeps maximum width. */}
      {isLandscape ? (
        <View style={styles.bottomBarLandscape}>
          <TouchableOpacity style={[styles.controlButton, styles.controlButtonLandscape]} onPress={() => setTorch(!torch)}>
            <Text style={[styles.controlIcon, styles.controlIconLandscape]}>{torch ? '⚡' : '🔌'}</Text>
            <Text style={[styles.controlText, styles.controlTextLandscape]}>Flash</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlButton, styles.controlButtonLandscape]} onPress={toggleGrid}>
            <Text style={[styles.controlIcon, styles.controlIconLandscape]}>{gridOverlay ? '🟰' : '📐'}</Text>
            <Text style={[styles.controlText, styles.controlTextLandscape]}>Grid</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlButton, styles.controlButtonLandscape]} onPress={startTimer}>
            <Text style={[styles.controlIcon, styles.controlIconLandscape]}>⏱</Text>
            <Text style={[styles.controlText, styles.controlTextLandscape]}>Timer</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlButton, styles.controlButtonLandscape]} onPress={toggleFacing}>
            <Text style={[styles.controlIcon, styles.controlIconLandscape]}>🔄</Text>
            <Text style={[styles.controlText, styles.controlTextLandscape]}>Flip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.streamButton, styles.streamButtonLandscape, isStreaming ? styles.stopButton : styles.goLiveButton]}
            onPress={() => void toggleStreaming()}
          >
            <Text style={[styles.streamButtonText, styles.streamButtonTextLandscape]}>
              {isStreaming ? 'Stop Stream' : 'Go Live'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={styles.controlButton} onPress={() => setTorch(!torch)}>
            <Text style={styles.controlIcon}>{torch ? '⚡' : '🔌'}</Text>
            <Text style={styles.controlText}>Flash</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton} onPress={toggleGrid}>
            <Text style={styles.controlIcon}>{gridOverlay ? '🟰' : '📐'}</Text>
            <Text style={styles.controlText}>Grid</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton} onPress={startTimer}>
            <Text style={styles.controlIcon}>⏱</Text>
            <Text style={styles.controlText}>Timer</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.controlButton} onPress={toggleFacing}>
            <Text style={styles.controlIcon}>🔄</Text>
            <Text style={styles.controlText}>Flip</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.streamButton, isStreaming ? styles.stopButton : styles.goLiveButton]}
            onPress={() => void toggleStreaming()}
          >
            <Text style={styles.streamButtonText}>{isStreaming ? 'Stop Stream' : 'Go Live'}</Text>
          </TouchableOpacity>
        </View>
      )}

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
    left: 12,
    right: 12,
    bottom: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 17, 23, 0.8)',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: 10,
  },
  bottomBarLandscape: {
    position: 'absolute',
    top: 80,
    right: 12,
    bottom: 12,
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(15, 17, 23, 0.75)',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    zIndex: 10,
    width: 74,
  },
  controlButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 48,
  },
  controlIcon: {
    fontSize: 18,
    marginBottom: 3,
  },
  controlText: {
    color: '#c9d1d9',
    fontSize: 10,
    fontWeight: '500',
  },
  streamButton: {
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 14,
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
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  /* --- Landscape overrides --- */
  errorBanner: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 180,
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

  /* --- Digital camera feature styles --- */
  streamingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
  },
  streamingText: {
    color: '#eb5757',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  streamingSub: {
    color: '#c9d1d9',
    fontSize: 13,
    marginTop: 6,
  },
  focusRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderWidth: 2,
    borderColor: '#0a84ff',
    borderRadius: 30,
  },
  timerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    zIndex: 20,
  },
  timerText: {
    color: '#fff',
    fontSize: 72,
    fontWeight: '800',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 15,
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  gridLineTop: {
    top: '33.33%',
  },
  gridLineBottom: {
    bottom: '33.33%',
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
  },
  gridLineVLeft: {
    left: '33.33%',
  },
  gridLineVRight: {
    right: '33.33%',
  },
  zoomIndicator: {
    position: 'absolute',
    bottom: 200,
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'rgba(15, 17, 23, 0.7)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    zIndex: 10,
  },
  zoomMinus: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  zoomText: {
    color: '#c9d1d9',
    fontSize: 14,
    fontWeight: '600',
  },
  zoomActive: {
    color: '#0a84ff',
  },

  /* --- Landscape overrides --- */
  controlButtonLandscape: {
    minWidth: 56,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  controlIconLandscape: {
    fontSize: 18,
    marginBottom: 2,
  },
  controlTextLandscape: {
    fontSize: 10,
  },
  streamButtonLandscape: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 14,
  },
  streamButtonTextLandscape: {
    fontSize: 14,
  },
  zoomIndicatorLandscape: {
    bottom: 'auto',
    top: 120,
    left: 12,
    right: 'auto',
  },
});
