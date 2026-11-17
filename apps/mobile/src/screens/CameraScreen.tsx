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
  const [focusPoint, setFocusPoint] = React.useState<{ x: number; y: number } | null>(null);
  const [isPinchZooming, setIsPinchZooming] = React.useState(false);
  const pinchStartZoomRef = React.useRef(1.0);
  const zoomDebounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply a zoom level to the native camera immediately (used for discrete
  // button taps and for flushing the final pinch value on release).
  const applyZoom = React.useCallback(
    (level: number) => {
      if (zoomDebounceTimer.current) {
        clearTimeout(zoomDebounceTimer.current);
        zoomDebounceTimer.current = null;
      }
      void CameraService.setZoom(level).catch(() => undefined);
    },
    [],
  );

  // Debounce native zoom calls during continuous pinch dragging so we don't
  // tear down and rebuild the Camera2 capture request on every drag frame.
  const debounceZoom = React.useCallback(
    (level: number) => {
      if (zoomDebounceTimer.current) {
        clearTimeout(zoomDebounceTimer.current);
      }
      zoomDebounceTimer.current = setTimeout(() => {
        zoomDebounceTimer.current = null;
        void CameraService.setZoom(level).catch(() => undefined);
      }, 120);
    },
    [],
  );

  // Flush any pending debounced zoom on unmount so we don't call setZoom on
  // a torn-down component.
  React.useEffect(() => {
    return () => {
      if (zoomDebounceTimer.current) {
        clearTimeout(zoomDebounceTimer.current);
        zoomDebounceTimer.current = null;
      }
    };
  }, []);

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
  // Vertical drag smoothly changes zoom level (negative dy = zoom in).
  // The responder only claims gestures that look like a drag (movement > 4
  // points) so taps on the zoom buttons inside the preview are not stolen.
  const panResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 4 || Math.abs(gestureState.dx) > 4;
        },
        onPanResponderGrant: (_, gestureState) => {
          setIsPinchZooming(true);
          pinchStartZoomRef.current = zoomLevel;
          if (focusPoint) setFocusPoint(null);
        },
        onPanResponderMove: (_, gestureState) => {
          const delta = -gestureState.dy / 100;
          const next = Math.min(
            maxZoom,
            Math.max(1.0, pinchStartZoomRef.current + delta),
          );
          setZoomLevel(next);
          debounceZoom(next);
        },
        onPanResponderRelease: () => {
          setIsPinchZooming(false);
          applyZoom(zoomLevel);
        },
        onPanResponderTerminate: () => {
          setIsPinchZooming(false);
          applyZoom(zoomLevel);
        },
      }),
    [maxZoom, zoomLevel, debounceZoom, applyZoom],
  );

  // Tap to focus / expose on the preview.
  const handlePreviewPress = (event: { nativeEvent: { locationX: number; locationY: number } }) => {
    const { locationX, locationY } = event.nativeEvent;
    setFocusPoint({ x: locationX, y: locationY });
    void CameraService.setFocusMode('autoFocus').catch(() => undefined);
    setTimeout(() => void CameraService.setFocusMode(focusMode).catch(() => undefined), 1500);
  };

  // Request permissions on mount so the preview is live immediately.
  // Signaling starts with the app; the media session starts itself the
  // moment OBS connects — there is nothing to press here.
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
        // Sync maxZoom with the hardware capability of the selected camera.
        try {
          const max = await CameraService.getMaxZoom(available[0].id);
          setMaxZoom(Math.max(1.0, max));
        } catch {
          // Keep the default maxZoom if the query fails.
        }
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

  const toggleFacing = async () => {
    setFacing((prev) => (prev === 'back' ? 'front' : 'back'));
    const next = cameras.find((c) => c.facing === (facing === 'back' ? 'front' : 'back'));
    if (next) {
      // Reset zoom when switching cameras — each camera starts at 1.0x.
      setZoomLevel(1.0);
      pinchStartZoomRef.current = 1.0;
      applyZoom(1.0);
      setSelectedCamera(next.id);
      // Sync maxZoom with the hardware capability of the new camera.
      try {
        const max = await CameraService.getMaxZoom(next.id);
        setMaxZoom(Math.max(1.0, max));
      } catch {
        // Keep the current maxZoom if the query fails.
      }
    }
  };

  const handleZoomChange = (delta: number) => {
    const next = Math.min(maxZoom, Math.max(1.0, zoomLevel + delta));
    setZoomLevel(next);
    setIsPinchZooming(false);
    applyZoom(next);
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

  // The passive pipeline serves whichever camera is selected here.
  React.useEffect(() => {
    streamingService.setPreferredCamera(selectedCamera);
  }, [selectedCamera]);

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
          Ojowacam needs access to your camera to send your feed to OBS.
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

        {/* Grid overlay (rule of thirds) */}
        {gridOverlay && (
          <View style={styles.gridOverlay}>
            <View style={[styles.gridLine, styles.gridLineTop]} />
            <View style={[styles.gridLine, styles.gridLineBottom]} />
            <View style={[styles.gridLineV, styles.gridLineVLeft]} />
            <View style={[styles.gridLineV, styles.gridLineVRight]} />
          </View>
        )}
      </View>

      {/* Zoom indicator (outside the PanResponder view so button touches aren't stolen) */}
      <View style={[styles.zoomIndicator, isLandscape && styles.zoomIndicatorLandscape]}>
        <TouchableOpacity style={styles.zoomMinus} onPress={() => handleZoomChange(-0.5)}>
          <Text style={styles.zoomText}>−</Text>
        </TouchableOpacity>
        <Text style={styles.zoomText}>{zoomLevel.toFixed(1)}×</Text>
        <TouchableOpacity style={styles.zoomMinus} onPress={() => handleZoomChange(0.5)}>
          <Text style={styles.zoomText}>+</Text>
        </TouchableOpacity>
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
          <TouchableOpacity style={[styles.controlButton, styles.controlButtonLandscape]} onPress={() => setTorch(!torch)}>
            <Text style={[styles.controlIcon, styles.controlIconLandscape]}>{torch ? '⚡' : '🔌'}</Text>
            <Text style={[styles.controlText, styles.controlTextLandscape]}>Flash</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlButton, styles.controlButtonLandscape]} onPress={toggleGrid}>
            <Text style={[styles.controlIcon, styles.controlIconLandscape]}>{gridOverlay ? '🟰' : '📐'}</Text>
            <Text style={[styles.controlText, styles.controlTextLandscape]}>Grid</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlButton, styles.controlButtonLandscape]} onPress={toggleFacing}>
            <Text style={[styles.controlIcon, styles.controlIconLandscape]}>🔄</Text>
            <Text style={[styles.controlText, styles.controlTextLandscape]}>Flip</Text>
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
  focusRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderWidth: 2,
    borderColor: '#0a84ff',
    borderRadius: 30,
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
