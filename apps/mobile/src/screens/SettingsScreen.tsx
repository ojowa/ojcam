import React from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView, Switch, TextInput, Alert } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { connectionConfig } from '../services/config/ConnectionConfig';

export default function SettingsScreen() {
  const [host, setHost] = React.useState('');
  const [endpoint, setEndpoint] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      await connectionConfig.load();
      setHost(connectionConfig.getHost());
      setEndpoint(connectionConfig.getSignalingUrl());
    })();
  }, []);

  const saveHost = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const url = await connectionConfig.setHost(host);
      setEndpoint(url);
      setHost(connectionConfig.getHost());
      Alert.alert('Saved', `Signaling endpoint set to ${url}`);
    } catch (error) {
      Alert.alert('Invalid Host', error instanceof Error ? error.message : 'Unable to save host.');
    } finally {
      setSaving(false);
    }
  };

  const resetHost = async () => {
    const url = await connectionConfig.resetHost();
    setHost(connectionConfig.getHost());
    setEndpoint(url);
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Settings</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Signaling Server</Text>
        <Text style={styles.fieldLabel}>Desktop host / IP</Text>
        <TextInput
          style={styles.input}
          value={host}
          onChangeText={setHost}
          placeholder="e.g. 192.168.1.20"
          placeholderTextColor="#999"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.hint}>
          On a physical phone, use your computer&apos;s LAN IP. localhost only works in an emulator.
        </Text>
        <Text style={styles.endpoint}>Active: {endpoint}</Text>
        <TouchableOpacity style={styles.button} onPress={saveHost} disabled={saving}>
          <Text style={styles.buttonText}>{saving ? 'Saving…' : 'Save Host'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.buttonOutline} onPress={() => void resetHost()}>
          <Text style={styles.buttonOutlineText}>Reset to localhost</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Video Quality</Text>
        <TouchableOpacity style={styles.row}>
          <Text>720p 30fps</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.row}>
          <Text>1080p 30fps</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.row}>
          <Text>1080p 60fps</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.row}>
          <Text>4K 30fps</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Audio</Text>
        <View style={styles.row}>
          <Text>Microphone</Text>
          <Switch value={true} onValueChange={() => {}} />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>About</Text>
        <TouchableOpacity style={styles.row}>
          <Text>Version 1.0.0</Text>
        </TouchableOpacity>
      </View>

      <StatusBar style="auto" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 20,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1a1a1a',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  fieldLabel: {
    color: '#666',
    fontSize: 13,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1a1a1a',
    backgroundColor: '#f9f9f9',
    marginBottom: 8,
  },
  hint: {
    color: '#888',
    fontSize: 12,
    marginBottom: 8,
    lineHeight: 16,
  },
  endpoint: {
    color: '#007AFF',
    fontSize: 13,
    marginBottom: 12,
    fontFamily: 'monospace',
  },
  button: {
    backgroundColor: '#007AFF',
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
    borderColor: '#007AFF',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  buttonOutlineText: {
    color: '#007AFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
