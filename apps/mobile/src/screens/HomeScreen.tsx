import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { HomeScreenNavigationProp } from '../../App';
import { streamSettings } from '../services/config/StreamSettings';

export default function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const [qualityLabel, setQualityLabel] = React.useState('4K');
  const [qualityFps, setQualityFps] = React.useState(30);
  const [audioEnabled, setAudioEnabled] = React.useState(true);

  // Reflect the saved stream preferences whenever this screen regains focus.
  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      void (async () => {
        await streamSettings.load();
        if (!active) return;
        setQualityLabel(streamSettings.getResolutionLabel());
        setQualityFps(streamSettings.getFps());
        setAudioEnabled(streamSettings.isAudioEnabled());
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Ojowacam</Text>
        <Text style={styles.subtitle}>Your Phone. Your Camera. Your Studio.</Text>
      </View>

      <View style={styles.card}>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Camera')}>
          <Text style={styles.buttonText}>Start Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Audio')}>
          <Text style={styles.buttonText}>Wireless Mic</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.button} onPress={() => navigation.navigate('Connection')}>
          <Text style={styles.buttonText}>Connect to OBS</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Quick Settings</Text>
        <TouchableOpacity style={styles.row} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.rowLabel}>Quality</Text>
          <Text style={styles.rowValue}>{qualityLabel} {qualityFps}fps</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.row, styles.lastRow]} onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.rowLabel}>Audio</Text>
          <Text style={styles.rowValue}>{audioEnabled ? 'On' : 'Off'}</Text>
        </TouchableOpacity>
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
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#8e93a0',
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#8e93a0',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#0a84ff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
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
  rowValue: {
    fontSize: 15,
    color: '#0a84ff',
    fontWeight: '600',
  },
});
