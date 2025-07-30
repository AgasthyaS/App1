import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import Sidebar from '../components/Sidebar';

export default function HomeScreen() {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

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
    <Drawer
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      drawerPosition="left"
      drawerStyle={{ 
        backgroundColor: '#E8F5E9',
        width: '30%'
      }}
      renderDrawerContent={() => <Sidebar onClose={() => setOpen(false)} />}
    >
      <View style={styles.container}>
        <TouchableOpacity
          style={styles.menuButton}
          onPress={() => setOpen(true)}
        >
          <Ionicons name="menu" size={28} color="#2E7D32" />
        </TouchableOpacity>
        <Text style={styles.welcomeText}>Welcome to your garden!</Text>
        <Text style={styles.locationText}>{text}</Text>
      </View>
    </Drawer>
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
  menuButton: {
    position: 'absolute',
    top: 25,
    left: 16,
    zIndex: 1,
    padding: 8,
  },
});