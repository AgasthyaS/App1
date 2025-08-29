import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

  let locationText = 'Getting your location...';
  if (errorMsg) {
    locationText = 'Location unavailable';
  } else if (location) {
    locationText = `${location.coords.latitude.toFixed(4)}, ${location.coords.longitude.toFixed(4)}`;
  }

  const quickActions = [
    {
      title: 'Plant AI',
      description: 'Identify plants and get care tips',
      icon: 'leaf',
      color: '#4CAF50',
      route: '/ai',
    },
    {
      title: 'Plant Health',
      description: 'Diagnose diseases and pests',
      icon: 'medical',
      color: '#FF9800',
      route: '/plant-health',
    },
    {
      title: 'Sustainability',
      description: 'Eco-friendly gardening guides',
      icon: 'leaf-outline',
      color: '#2196F3',
      route: '/sustainability',
    },
    {
      title: 'Calendar',
      description: 'Track your garden tasks',
      icon: 'calendar',
      color: '#9C27B0',
      route: '/calendar',
    },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.heroIcon}>
            <Ionicons name="leaf" size={48} color="#2E7D32" />
          </View>
          <Text style={styles.heroTitle}>Welcome to Your Garden!</Text>
          <Text style={styles.heroSubtitle}>
            Your personal gardening companion for a thriving, sustainable garden
          </Text>
        </View>

        {/* Location Card */}
        <View style={styles.locationCard}>
          <View style={styles.locationHeader}>
            <Ionicons name="location" size={20} color="#2E7D32" />
            <Text style={styles.locationTitle}>Your Location</Text>
          </View>
          <Text style={styles.locationText}>{locationText}</Text>
          <Text style={styles.locationDescription}>
            We use your location to provide personalized gardening recommendations
          </Text>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActionsSection}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <Text style={styles.sectionDescription}>
            Get started with these essential gardening tools
          </Text>
          
          <View style={styles.quickActionsGrid}>
            {quickActions.map((action, index) => (
              <TouchableOpacity key={index} style={styles.quickActionCard}>
                <View style={[styles.actionIcon, { backgroundColor: action.color + '20' }]}>
                  <Ionicons name={action.icon as any} size={24} color={action.color} />
                </View>
                <Text style={styles.actionTitle}>{action.title}</Text>
                <Text style={styles.actionDescription}>{action.description}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Garden Tips */}
        <View style={styles.tipsSection}>
          <Text style={styles.sectionTitle}>Today's Garden Tip</Text>
          <View style={styles.tipCard}>
            <View style={styles.tipIcon}>
              <Ionicons name="bulb" size={24} color="#FF9800" />
            </View>
            <View style={styles.tipContent}>
              <Text style={styles.tipTitle}>Water Early in the Morning</Text>
              <Text style={styles.tipText}>
                Water your plants early in the morning to reduce evaporation and prevent fungal diseases. This allows the water to reach the roots before the heat of the day.
              </Text>
            </View>
          </View>
        </View>

        {/* Weather Summary */}
        <View style={styles.weatherSection}>
          <Text style={styles.sectionTitle}>Garden Weather</Text>
          <View style={styles.weatherCard}>
            <View style={styles.weatherInfo}>
              <Ionicons name="partly-sunny" size={32} color="#FF9800" />
              <View style={styles.weatherDetails}>
                <Text style={styles.weatherTemp}>22°C</Text>
                <Text style={styles.weatherDesc}>Partly Cloudy</Text>
              </View>
            </View>
            <View style={styles.weatherStats}>
              <View style={styles.weatherStat}>
                <Ionicons name="water" size={16} color="#2196F3" />
                <Text style={styles.weatherStatText}>65% Humidity</Text>
              </View>
              <View style={styles.weatherStat}>
                <Ionicons name="rainy" size={16} color="#2196F3" />
                <Text style={styles.weatherStatText}>30% Rain</Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8F5E9',
  },
  scrollView: {
    flex: 1,
  },
  heroSection: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: 'white',
    margin: 20,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  heroIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F1F8E9',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 8,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  locationCard: {
    backgroundColor: 'white',
    marginHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  locationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  locationTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2E7D32',
    marginLeft: 8,
  },
  locationText: {
    fontSize: 16,
    color: '#444',
    marginBottom: 8,
    fontFamily: 'monospace',
  },
  locationDescription: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
  },
  quickActionsSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 16,
    color: '#666',
    marginBottom: 16,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickActionCard: {
    width: '48%',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 4,
  },
  actionDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 18,
  },
  tipsSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  tipCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  tipIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFF3E0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  tipContent: {
    flex: 1,
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 8,
  },
  tipText: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  weatherSection: {
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  weatherCard: {
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  weatherInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  weatherDetails: {
    marginLeft: 16,
  },
  weatherTemp: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  weatherDesc: {
    fontSize: 16,
    color: '#666',
  },
  weatherStats: {
    flexDirection: 'row',
    gap: 20,
  },
  weatherStat: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  weatherStatText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 6,
  },
});