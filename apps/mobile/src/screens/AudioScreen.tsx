import React from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Switch,
  ScrollView,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { streamingService } from '../services/StreamingService';
import { streamSettings } from '../services/config/StreamSettings';
import { AudioService } from '../native/modules';

/**
 * AudioScreen — "Wireless Mic": streams the phone's microphone straight to
 * OBS over the signaling WebSocket as raw PCM (no camera, no WebRTC).
 * Every control here is real: capture, mute, platform noise suppression,
 * gain, and the live level meter all drive the actual audio pipeline.
 */
export default function AudioScreen() {
  const navigation = useNavigation();
  const [broadcasting, setBroadcasting] = React.useState(false);
  const [muted, setMuted] = React.useState(false);
  const [noiseSuppression, setNoiseSuppression] = React.useState(true);
  const [gainBoost, setGainBoost] = React.useState(1.0);
  const [level, setLevel] = React.useState(0);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      void (async () => {
        await streamSettings.load();
        if (!active) return;
        setNoiseSuppression(streamSettings.isNoiseSuppressionEnabled());
        setGainBoost(streamSettings.getGainBoost());
        setBroadcasting(streamingService.getIsAudioBroadcasting());
        setMuted(streamingService.getIsAudioMuted());
        setError(streamingService.getState().error);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  // Live level meter: poll the native RMS while the broadcast is running.
  React.useEffect(() => {
    if (!broadcasting) {
      setLevel(0);
      return;
    }
    const id = setInterval(() => {
      void AudioService.getAudioLevels()
        .then((value) => setLevel(Math.min(1, Math.max(0, value))))
        .catch(() => undefined);
    }, 150);
    return () => clearInterval(id);
  }, [broadcasting]);

  const toggleBroadcast = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (broadcasting) {
        const stopped = await streamingService.stopAudioBroadcast();
        setBroadcasting(!stopped ? streamingService.getIsAudioBroadcasting() : false);
        setMuted(streamingService.getIsAudioMuted());
        if (!stopped) setError(streamingService.getState().error);
      } else {
        const started = await streamingService.startAudioBroadcast();
        setBroadcasting(started);
        setMuted(streamingService.getIsAudioMuted());
        if (!started) setError(streamingService.getState().error);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    streamingService.setAudioMuted(next);
    setMuted(next);
  };

  const toggleNoiseSuppression = async (value: boolean) => {
    setNoiseSuppression(value);
    await streamSettings.setNoiseSuppression(value);
    if (broadcasting) {
      await AudioService.setNoiseSuppression(value).catch(() => undefined);
    }
  };

  const changeGain = async (delta: number) => {
    const next = Math.min(4, Math.max(1, Math.round((gainBoost + delta) * 2) / 2));
    setGainBoost(next);
    await streamSettings.setGainBoost(next);
    if (broadcasting) {
      await AudioService.setGain(next).catch(() => undefined);
    }
  };

  const percent = Math.round(level * 100);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Wireless Mic</Text>
        <Text style={styles.subtitle}>Your microphone, straight to OBS.</Text>
      </View>

      <View style={styles.card}>
        <View style={[styles.meterTrack, broadcasting ? undefined : styles.meterTrackIdle]}>
          <View
            style={[
              styles.meterFill,
              { width: `${percent}%` },
              muted ? styles.meterFillMuted : undefined,
            ]}
          />
        </View>
        <View style={styles.meterLabels}>
          <Text style={styles.meterText}>{broadcasting ? `Level ${percent}%` : 'Idle'}</Text>
          <Text style={styles.meterText}>
            {broadcasting ? (muted ? 'Muted' : 'On Air') : 'Off'}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.button, broadcasting ? styles.buttonLive : styles.buttonIdle, busy ? styles.buttonBusy : undefined]}
          onPress={() => void toggleBroadcast()}
          disabled={busy}
        >
          <Text style={styles.buttonText}>
            {busy ? 'Working…' : broadcasting ? 'Stop Broadcast' : 'Start Broadcast'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, muted ? styles.buttonMuted : styles.buttonMuteIdle]}
          onPress={toggleMute}
          disabled={!broadcasting}
        >
          <Text style={styles.buttonText}>{muted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Audio Processing</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Noise Suppression</Text>
          <Switch
            value={noiseSuppression}
            onValueChange={(value) => void toggleNoiseSuppression(value)}
            trackColor={{ false: '#30363d', true: '#0a84ff80' }}
            thumbColor={noiseSuppression ? '#0a84ff' : '#8e93a0'}
          />
        </View>
        <View style={[styles.row, styles.lastRow]}>
          <Text style={styles.rowLabel}>Gain Boost</Text>
          <View style={styles.stepper}>
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() => void changeGain(-0.5)}
              disabled={gainBoost <= 1}
            >
              <Text style={styles.stepButtonText}>−</Text>
            </TouchableOpacity>
            <Text style={styles.stepValue}>{gainBoost.toFixed(1)}×</Text>
            <TouchableOpacity
              style={styles.stepButton}
              onPress={() => void changeGain(0.5)}
              disabled={gainBoost >= 4}
            >
              <Text style={styles.stepButtonText}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

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
  header: {
    marginBottom: 4,
  },
  backButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: 12,
    marginBottom: 8,
  },
  backButtonText: {
    color: '#0a84ff',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#8e93a0',
    marginTop: 4,
    marginBottom: 16,
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
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8e93a0',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  meterTrack: {
    height: 14,
    borderRadius: 7,
    backgroundColor: '#212833',
    overflow: 'hidden',
    marginBottom: 8,
  },
  meterTrackIdle: {
    opacity: 0.5,
  },
  meterFill: {
    height: '100%',
    borderRadius: 7,
    backgroundColor: '#30d158',
  },
  meterFillMuted: {
    backgroundColor: '#ff453a',
  },
  meterLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  meterText: {
    fontSize: 13,
    color: '#8e93a0',
    fontWeight: '600',
  },
  button: {
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  buttonIdle: {
    backgroundColor: '#0a84ff',
  },
  buttonLive: {
    backgroundColor: '#ff453a',
  },
  buttonBusy: {
    opacity: 0.6,
  },
  buttonMuteIdle: {
    backgroundColor: '#30363d',
  },
  buttonMuted: {
    backgroundColor: '#ff9f0a',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  error: {
    color: '#ff453a',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#212833',
  },
  lastRow: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  rowLabel: {
    fontSize: 15,
    color: '#c9d1d9',
    fontWeight: '600',
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#30363d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: {
    opacity: 0.4,
  },
  stepButtonText: {
    color: '#0a84ff',
    fontSize: 20,
    fontWeight: '700',
  },
  stepValue: {
    color: '#0a84ff',
    fontSize: 15,
    fontWeight: '700',
    marginHorizontal: 14,
    minWidth: 44,
    textAlign: 'center',
  },
});
