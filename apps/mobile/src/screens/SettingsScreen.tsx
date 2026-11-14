import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Switch, TextInput, Alert, SafeAreaView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from '@react-navigation/native';
import { connectionConfig } from '../services/config/ConnectionConfig';
import { streamSettings, type StreamResolution, type StreamFps } from '../services/config/StreamSettings';
import { CameraService } from '../native/modules';

const RESOLUTION_OPTIONS: Array<{ label: '720p' | '1080p' | '4K'; value: StreamResolution }> = [
  { label: '720p', value: '1280x720' },
  { label: '1080p', value: '1920x1080' },
  { label: '4K', value: '3840x2160' },
];

const FPS_OPTIONS: Array<{ label: '30fps' | '60fps'; value: StreamFps }> = [
  { label: '30fps', value: 30 },
  { label: '60fps', value: 60 },
];

export default function SettingsScreen() {
  const navigation = useNavigation();

  // Signaling port (real, persisted via ConnectionConfig).
  const [port, setPort] = React.useState('');
  const [endpoint, setEndpoint] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  // Stream preferences (persisted via StreamSettings).
  const [resolution, setResolution] = React.useState<StreamResolution>('3840x2160');
  const [fps, setFps] = React.useState<StreamFps>(30);
  const [audioEnabled, setAudioEnabled] = React.useState(true);
  const [autoFocus, setAutoFocus] = React.useState(true);

  React.useEffect(() => {
    void (async () => {
      await Promise.all([connectionConfig.load(), streamSettings.load()]);
      setPort(String(connectionConfig.getPort()));
      setEndpoint(connectionConfig.getSignalingUrl());
      setResolution(streamSettings.getResolution());
      setFps(streamSettings.getFps());
      setAudioEnabled(streamSettings.isAudioEnabled());
      setAutoFocus(streamSettings.isAutoFocus());
    })();
  }, []);

  const savePort = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const parsed = parseInt(port.trim(), 10);
      if (!Number.isInteger(parsed)) throw new Error('Enter a valid port number');
      const url = await connectionConfig.setPort(parsed);
      setEndpoint(url);
      setPort(String(connectionConfig.getPort()));
      Alert.alert('Saved', `Signaling server listening on ${url}`);
    } catch (error) {
      Alert.alert('Invalid Port', error instanceof Error ? error.message : 'Unable to save port.');
    } finally {
      setSaving(false);
    }
  };

  const resetPort = async () => {
    const url = await connectionConfig.resetPort();
    setPort(String(connectionConfig.getPort()));
    setEndpoint(url);
  };

  const chooseResolution = async (value: StreamResolution) => {
    setResolution(value);
    await streamSettings.setResolution(value);
  };

  const chooseFps = async (value: StreamFps) => {
    setFps(value);
    await streamSettings.setFps(value);
  };

  const toggleAudio = async (value: boolean) => {
    setAudioEnabled(value);
    await streamSettings.setAudioEnabled(value);
  };

  const toggleAutoFocus = async (value: boolean) => {
    setAutoFocus(value);
    await streamSettings.setAutoFocus(value);
    // Best effort: only takes effect while the camera is capturing.
    void CameraService.setFocusMode(value ? 'continuousAutoFocus' : 'locked');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Top Bar / Back Button */}
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
            <Text style={styles.iconButtonText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.screenHeaderTitle}>Studio Settings</Text>
          <View style={{ width: 40 }} />
        </View>

        {/* Header Title */}
        <View style={styles.headerCard}>
          <Text style={styles.title}>Preferences</Text>
          <Text style={styles.subtitle}>
            Configure video quality, capture rates, and microphone settings for your stream.
          </Text>
        </View>

        {/* Signaling Server Section (real, kept from previous settings) */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Signaling Server</Text>
          <Text style={styles.fieldLabel}>Listen port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            placeholder="8765"
            placeholderTextColor="#8e93a0"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
          />
          <Text style={styles.hint}>
            The phone hosts the signaling server on this port. Set the OBS
            signaling URL to ws://&lt;phone-ip&gt;:&lt;port&gt; (shown on the
            Connection screen).
          </Text>
          <Text style={styles.endpoint}>Active: {endpoint}</Text>
          <TouchableOpacity style={styles.button} onPress={() => void savePort()} disabled={saving}>
            <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Port'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.buttonOutline} onPress={() => void resetPort()}>
            <Text style={styles.buttonOutlineText}>Reset to default (8765)</Text>
          </TouchableOpacity>
        </View>

        {/* Video Quality Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Video Resolution</Text>
          <View style={styles.optionRow}>
            {RESOLUTION_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chipButton, resolution === opt.value && styles.chipActive]}
                onPress={() => void chooseResolution(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, resolution === opt.value && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Framerate Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Framerate (FPS)</Text>
          <View style={styles.optionRow}>
            {FPS_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[styles.chipButton, fps === opt.value && styles.chipActive]}
                onPress={() => void chooseFps(opt.value)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, fps === opt.value && styles.chipTextActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Toggle Settings Section */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Hardware & Audio</Text>

          {/* Audio Toggle */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleLabel}>Microphone Audio</Text>
              <Text style={styles.toggleSubtext}>Stream live phone audio to OBS</Text>
            </View>
            <Switch
              trackColor={{ false: '#212833', true: '#0a84ff' }}
              thumbColor={'#fff'}
              ios_backgroundColor="#212833"
              onValueChange={(v) => void toggleAudio(v)}
              value={audioEnabled}
            />
          </View>

          {/* Auto-Focus Toggle */}
          <View style={[styles.toggleRow, styles.lastToggleRow]}>
            <View style={styles.toggleTextWrap}>
              <Text style={styles.toggleLabel}>Continuous Auto-Focus</Text>
              <Text style={styles.toggleSubtext}>Keep camera lens locked on focus</Text>
            </View>
            <Switch
              trackColor={{ false: '#212833', true: '#0a84ff' }}
              thumbColor={'#fff'}
              ios_backgroundColor="#212833"
              onValueChange={(v) => void toggleAutoFocus(v)}
              value={autoFocus}
            />
          </View>
        </View>

      </ScrollView>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f1117',
  },
  container: {
    padding: 20,
    paddingBottom: 40,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1c212e',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2d3548',
  },
  iconButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  screenHeaderTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  headerCard: {
    marginBottom: 24,
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#ffffff',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    color: '#8e93a0',
    lineHeight: 22,
  },
  sectionCard: {
    backgroundColor: '#161b22',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#212833',
    marginBottom: 20,
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
    marginBottom: 14,
  },
  optionRow: {
    flexDirection: 'row',
    gap: 12,
  },
  chipButton: {
    flex: 1,
    backgroundColor: '#0f1117',
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  chipActive: {
    backgroundColor: 'rgba(10, 132, 255, 0.15)',
    borderColor: '#0a84ff',
  },
  chipText: {
    color: '#8e93a0',
    fontSize: 15,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#0a84ff',
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#212833',
  },
  lastToggleRow: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  toggleTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  toggleLabel: {
    fontSize: 15,
    color: '#c9d1d9',
    fontWeight: '600',
    marginBottom: 2,
  },
  toggleSubtext: {
    fontSize: 12,
    color: '#8e93a0',
  },
  fieldLabel: {
    color: '#8e93a0',
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#30363d',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#fff',
    backgroundColor: '#0f1117',
    marginBottom: 8,
  },
  hint: {
    color: '#8e93a0',
    fontSize: 12,
    marginBottom: 8,
    lineHeight: 16,
  },
  endpoint: {
    color: '#0a84ff',
    fontSize: 13,
    marginBottom: 12,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#0a84ff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: '#0a84ff',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  buttonOutlineText: {
    color: '#0a84ff',
    fontSize: 15,
    fontWeight: '600',
  },
});
