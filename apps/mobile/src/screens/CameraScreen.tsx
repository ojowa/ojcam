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
import { CameraService } from '../native/modules';
import { CameraDevice } from '../native/modules';
import { signalingService } from '../services/signaling/SignalingService';
import { streamingService } from '../services/StreamingService';
import { streamSettings } from '../services/config/StreamSettings';

export type ZoomLevel = 1 | 2 | 3;
export type FocusMode = 'continuousAutoFocus' | 'locked' | 'autoFocus';
export type WhiteBalance = 'auto' | 'daylight' | 'cloudy' | 'fluorescent';

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
  const [cameras, setCameras] = React.useState<CameraDevice[]>([]);
  const [selectedCamera, setSelectedCamera] = React.useState<string>('0');
  const [facing, setFacing] = React.useState<'front' | 'back'>('back');
  const [torch, setTorch] = React.useState(false);
  const [orientation, setOrientation] = React.useState<'portrait' | 'landscape'>('portrait');
  const [permission, setPermission] = React.useState<boolean | null>(null);
  const [cameraReady, setCameraReady] = React.useState(false);
  const cameraRef = React.useRef<Camera>(null);

  // Digital camera controls
  const [zoomLevel, setZoomLevel] = React.useState<number>(1.0);
  const [maxZoom, setMaxZoom] = React.useState<number>(4.0);
  const [focusMode, setFocusMode] = React.useState<FocusMode>('continuousAutoFocus');
  const [whiteBalance, setWhiteBalance] = React.useState<WhiteBalance>('auto');
  const [gridOverlay, setGridOverlay] = React.useState(false);
  const [timerActive, setTimerActive] = React.useState(false);
  const [timerSeconds, setTimerSeconds] = React.useState(3);
  const [focusPoint, setFocusPoint] = React.useState<{ x: number; y: number } | null>(null);
  const [isPinchZooming, setIsPinchZooming] = React.useState(false);
  const [pinchStartZoom, setPinchStartZoom] = React.useState<number>(1.0);

  // Streaming state
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [streamError, setStreamError] = React.useState<string | null>(null);

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

  // Apply focus mode when it changes.
  React.useEffect(() => {
    void CameraService.setFocusMode(focusMode).catch(() => undefined);
  }, [focusMode]);

  // Pinch-to-zoom responder for the preview.
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
          // Vertical drag smoothly changes zoom level (negative dy = zoom in)
          const delta = -gestureState.dy / 100;
          setZoomLevel((prev) => Math.min(maxZoom, Math.max(1.0, pinchStartZoom + delta)));
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
    void CameraService.setFocusMode('autoFocus').catch(() => undefined);
    setTimeout(() => void CameraService.setFocusMode(focusMode).catch(() => undefined), 1500);
  };

  // Request permissions on mount. Camera + signaling start only when the user
  // taps "Start Streaming". No auto-connection.
  React.useEffect(() => {
    let active = true;
    void (async () => {
      const granted = await ensureCapturePermissions();
      setPermission(granted);
      setCameraReady(granted);
    })();
    return () => {
      active = false;
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

  // Re-read preferences when returning from the Settings screen.
  useFocusEffect(
    React.useCallback(() => {
      void streamSettings.load();
    }, []),
  );

  const toggleFacing = () => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    const next = cameras.find((c) => c.facing === (facing === 'back' ? 'front' : 'back'));
    if (next) setSelectedCamera(next.id);
  };

  const handleZoomChange = (delta: number) => {
    setZoomLevel((prev) => Math.min(maxZoom, Math.max(1.0, prev + delta)));
    setIsPinchZooming(false);
  };

  // Apply zoom changes to the camera hardware.
  React.useEffect(() => {
    void CameraService.setZoom(zoomLevel).catch(() => undefined);
  }, [zoomLevel]);

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

  // Start streaming: start camera capture, init signaling, begin WebRTC to OBS.
  const startStreaming = async () => {
    if (isStreaming) return;
    setStreamError(null);
    try {
      await streamSettings.load();
      await CameraService.startCapture(selectedCamera, streamSettings.getResolution().split('x').map(Number)[0], streamSettings.getResolution().split('x').map(Number)[1], streamSettings.getFps());
      await signalingService.initialize();
      setCameraReady(true);
      setIsStreaming(true);
    } catch (error) {
      setStreamError(error instanceof Error ? error.message : 'Failed to start streaming');
    }
  };

  // Stop streaming: release camera, close signaling, reset state.
  const stopStreaming = async () => {
    if (!isStreaming) return;
    try {
      await streamingService.stopStreaming();
    } catch {
      /* ignore stop errors */
    }
    signalingService.disconnect();
    setCameraReady(false);
    setIsStreaming(false);
    setStreamError(null);
  };

  // Listen to streaming state changes from the service.
  React.useEffect(() => {
    const unsubscribe = streamingService.setOnStateChange((state) => {
      setIsStreaming(state.isStreaming);
      setStreamError(state.error || null);
    });
    return () => unsubscribe();
  }, []);

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
        <TouchableOpacity style={styles.primaryButton} onPress={() => void ensureCapturePermissions().then((g) => setPermission(g))}>
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
        {!cameraReady ? (
          <View style={styles.previewOverlay}>
            <ActivityIndicator color="#fff" size="large" />
            <Text style={styles.previewText}>Starting camera…</Text>
          </View>
        ) : (
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            type={previewType}
            flashMode={torch ? FlashMode.torch : FlashMode.off}
          />
        )}

        {/* Focus point indicator (tap to focus) */}
        {focusPoint && (
          <View style={[styles.focusRing, { left: focusPoint.x - 30, top: focusPoint.y - 30 }]} />
        )}

        {/* Countdown timer overlay */}
        {timerActive && timerSeconds > 0 && (
          <View style={styles.timerOverlay}>
            <Text style={styles.timerText}>{timerSeconds}</Text>
          </View>
        )}

        {/* Grid overlay (rule of thirds) */}
        {gridOverlay && (
          <View style={styles.gridOverlay}>
            <View style={[styles.gridLine, styles.gridLineTop]} />
            <View style={[styles.gridLine, styles.gridLineBottom]} />
            <View style={[styles.gridLineV, styles.gridLineVLeft]} />
            <View style={[styles.gridLineV, styles.gridLineVRight]} />
          </View>
        )}

        {/* Zoom indicator */}
        <View style={[styles.zoomIndicator, isLandscape && styles.zoomIndicatorLandscape]}>
          <TouchableOpacity style={styles.zoomMinus} onPress={() => handleZoomChange(-0.5)}>
            <Text style={styles.zoomText}>−</Text>
          </TouchableOpacity>
          <Text style={styles.zoomText}>{zoomLevel.toFixed(1)}×</Text>
          <TouchableOpacity style={styles.zoomMinus} onPress={() => handleZoomChange(0.5)}>
            <Text style={styles.zoomText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <SafeAreaView style={[styles.topBar, isLandscape && styles.topBarLandscape]} pointerEvents="box-none">
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
          <Text style={styles.iconButtonText}>✕</Text>
        </TouchableOpacity>

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
        <Text style={styles.infoLabel}>OUT: {streamSettings.getResolution()} @ {streamSettings.getFps()}fps</Text>
        <Text style={styles.infoValue}>OBS Target: {streamSettings.getResolution()}</Text>
      </View>

      {/* Digital camera control bar. In landscape it becomes a vertical strip on
       * the right edge so the preview keeps maximum width. */}
      {isLandscape ? (
        <View style={styles.bottomBarLandscape}>
          <TouchableOpacity style={[styles.controlButton, styles.controlButtonLandscape]} onPress={isStreaming ? stopStreaming : startStreaming}>
            <Text style={[styles.controlIcon, styles.controlIconLandscape]}>{isStreaming ? '⏹' : '▶'}</Text>
            <Text style={[styles.controlText, styles.controlTextLandscape]}>{isStreaming ? 'Stop' : 'Stream'}</Text>
          </TouchableOpacity>
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
        </View>
      ) : (
        <View style={styles.bottomBar}>
          <TouchableOpacity style={[styles.controlButton, styles.streamingButton]} onPress={isStreaming ? stopStreaming : startStreaming}>
            <Text style={[styles.controlIcon, styles.streamingIcon]}>{isStreaming ? '⏹' : '▶'}</Text>
            <Text style={[styles.controlText, styles.streamingText]}>{isStreaming ? 'Stop Streaming' : 'Start Streaming'}</Text>
          </TouchableOpacity>
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
  streamingButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 48,
    backgroundColor: '#0a84ff',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  streamingIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  streamingText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
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
  zoomIndicatorLandscape: {
    bottom: 'auto',
    top: 120,
    left: 12,
    right: 'auto',
  },
});
