import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';

export default function ConnectionScreen() {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Connection</Text>
        <Text style={styles.subtitle}>Connect your phone to OBS Studio</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Connection Mode</Text>
        <TouchableOpacity style={styles.optionRow}>
          <Text>Wi-Fi</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.optionRow}>
          <Text>USB (ADB)</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Pairing</Text>
        <TouchableOpacity style={styles.button}>
          <Text>Show QR Code</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.buttonOutline}>
          <Text>Enter Pairing Code</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Status</Text>
        <View style={styles.statusRow}>
          <View style={styles.statusDot} />
          <Text>Disconnected</Text>
        </View>
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
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  button: {
    backgroundColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    alignItems: 'center',
  },
  buttonOutline: {
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
});
