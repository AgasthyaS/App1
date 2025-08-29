import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HomeScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission to access location was denied');
        return;
      }

      let location = await Location.getCurrentPositionAsync({});
      setLocation(location);
    })();
  }, []);

  let text = 'Waiting for location...';
  if (errorMsg) {
    text = errorMsg;
  } else if (location) {
    text = JSON.stringify({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.welcomeText}>Welcome to your garden!</Text>
      <Text style={styles.locationText}>{text}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 20,
  },
  locationText: {
    fontSize: 16,
    color: '#2E7D32',
    marginTop: 20,
    paddingHorizontal: 20,
    textAlign: 'center',
  },
});