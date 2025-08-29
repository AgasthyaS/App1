import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    ScrollView,
    StyleSheet,
    Switch,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface WeatherData {
  temperature: number;
  humidity: number;
  precipitation: number;
  forecast: string;
}

interface SustainabilityTip {
  id: string;
  title: string;
  description: string;
  category: 'composting' | 'herbicides' | 'water' | 'general';
  icon: string;
}

const SUSTAINABILITY_TIPS: SustainabilityTip[] = [
  {
    id: '1',
    title: 'Composting Basics',
    description: 'Start with kitchen scraps, yard waste, and paper. Layer brown (carbon) and green (nitrogen) materials. Turn weekly and keep moist.',
    category: 'composting',
    icon: 'leaf',
  },
  {
    id: '2',
    title: 'Organic Weed Control',
    description: 'Use vinegar, salt, and dish soap mixture. Apply on sunny days. For persistent weeds, try boiling water or manual removal.',
    category: 'herbicides',
    icon: 'bug',
  },
  {
    id: '3',
    title: 'Drip Irrigation',
    description: 'Install drip systems to deliver water directly to plant roots. Reduces evaporation and prevents fungal diseases.',
    category: 'water',
    icon: 'water',
  },
  {
    id: '4',
    title: 'Mulching',
    description: 'Apply 2-3 inches of organic mulch around plants. Retains moisture, suppresses weeds, and improves soil health.',
    category: 'general',
    icon: 'layers',
  },
  {
    id: '5',
    title: 'Rainwater Harvesting',
    description: 'Collect rainwater in barrels during storms. Use for irrigation to reduce municipal water consumption.',
    category: 'water',
    icon: 'rainy',
  },
  {
    id: '6',
    title: 'Companion Planting',
    description: 'Plant beneficial combinations like tomatoes with basil, or marigolds to deter pests naturally.',
    category: 'general',
    icon: 'flower',
  },
];

// Mock weather data for when location is not available
const MOCK_WEATHER_DATA: WeatherData = {
  temperature: 22,
  humidity: 65,
  precipitation: 30,
  forecast: 'Light rain expected in the next 24 hours',
};

export default function SustainabilityScreen() {
  const [weatherData, setWeatherData] = useState<WeatherData | null>(null);
  const [irrigationPaused, setIrrigationPaused] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'composting' | 'herbicides' | 'water' | 'general'>('all');
  const [locationEnabled, setLocationEnabled] = useState(false);

  useEffect(() => {
    fetchWeatherData();
    checkIrrigationStatus();
  }, []);

  const fetchWeatherData = async () => {
    try {
      // Check if location services are enabled
      const isLocationEnabled = await Location.hasServicesEnabledAsync();
      if (!isLocationEnabled) {
        console.log('Location services are disabled, using mock data');
        setWeatherData(MOCK_WEATHER_DATA);
        setLocationEnabled(false);
        return;
      }

      // Request location permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Location permission denied, using mock data');
        setWeatherData(MOCK_WEATHER_DATA);
        setLocationEnabled(false);
        return;
      }

      // Get current location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 10,
      });
      
      // In a real app, you would call a weather API here with the location coordinates
      // For now, we'll use mock data but mark location as enabled
      const weatherData: WeatherData = {
        temperature: 22 + Math.floor(Math.random() * 10), // Add some variation
        humidity: 60 + Math.floor(Math.random() * 20),
        precipitation: Math.floor(Math.random() * 50),
        forecast: 'Weather data based on your location',
      };
      
      setWeatherData(weatherData);
      setLocationEnabled(true);
      
      // Check if irrigation should be paused
      if (weatherData.precipitation > 20) {
        setIrrigationPaused(true);
        if (notificationsEnabled) {
          Alert.alert(
            'Irrigation Paused',
            'Rain is forecasted. Your irrigation system has been automatically paused to conserve water.',
            [{ text: 'OK' }]
          );
        }
      }
    } catch (error) {
      console.log('Error fetching weather data, using mock data:', error);
      setWeatherData(MOCK_WEATHER_DATA);
      setLocationEnabled(false);
    }
  };

  const checkIrrigationStatus = () => {
    // Simulate checking irrigation system status
    // In a real app, this would connect to smart irrigation controllers
  };

  const getFilteredTips = () => {
    if (selectedCategory === 'all') {
      return SUSTAINABILITY_TIPS;
    }
    return SUSTAINABILITY_TIPS.filter(tip => tip.category === selectedCategory);
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'composting': return '#8D6E63';
      case 'herbicides': return '#6D4C41';
      case 'water': return '#1976D2';
      case 'general': return '#388E3C';
      default: return '#757575';
    }
  };

  const renderWeatherCard = () => (
    <View style={styles.weatherCard}>
      <View style={styles.weatherHeader}>
        <Ionicons name="partly-sunny" size={24} color="#2E7D32" />
        <Text style={styles.weatherTitle}>Weather-Based Recommendations</Text>
        {!locationEnabled && (
          <View style={styles.locationStatus}>
            <Ionicons name="location" size={16} color="#F57C00" />
            <Text style={styles.locationStatusText}>Demo Mode</Text>
          </View>
        )}
      </View>
      
      {weatherData ? (
        <View style={styles.weatherContent}>
          <View style={styles.weatherRow}>
            <Text style={styles.weatherLabel}>Temperature:</Text>
            <Text style={styles.weatherValue}>{weatherData.temperature}°C</Text>
          </View>
          <View style={styles.weatherRow}>
            <Text style={styles.weatherLabel}>Humidity:</Text>
            <Text style={styles.weatherValue}>{weatherData.humidity}%</Text>
          </View>
          <View style={styles.weatherRow}>
            <Text style={styles.weatherLabel}>Precipitation:</Text>
            <Text style={styles.weatherValue}>{weatherData.precipitation}%</Text>
          </View>
          <Text style={styles.forecastText}>{weatherData.forecast}</Text>
          
          <View style={styles.irrigationStatus}>
            <Text style={styles.irrigationLabel}>Irrigation Status:</Text>
            <View style={styles.irrigationToggle}>
              <Text style={[styles.irrigationText, irrigationPaused && styles.pausedText]}>
                {irrigationPaused ? 'Paused' : 'Active'}
              </Text>
              <Switch
                value={!irrigationPaused}
                onValueChange={(value) => setIrrigationPaused(!value)}
                trackColor={{ false: '#C8E6C9', true: '#4CAF50' }}
                thumbColor={irrigationPaused ? '#f4f3f4' : '#2E7D32'}
              />
            </View>
          </View>
        </View>
      ) : (
        <Text style={styles.loadingText}>Loading weather data...</Text>
      )}
    </View>
  );

  const renderCategoryFilter = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryFilter}>
      {[
        { key: 'all', label: 'All', icon: 'grid' },
        { key: 'composting', label: 'Composting', icon: 'leaf' },
        { key: 'herbicides', label: 'Organic Control', icon: 'bug' },
        { key: 'water', label: 'Water Saving', icon: 'water' },
        { key: 'general', label: 'General Tips', icon: 'flower' },
      ].map((category) => (
        <TouchableOpacity
          key={category.key}
          style={[
            styles.categoryButton,
            selectedCategory === category.key && styles.categoryButtonActive
          ]}
          onPress={() => setSelectedCategory(category.key as any)}
        >
          <Ionicons 
            name={category.icon as any} 
            size={16} 
            color={selectedCategory === category.key ? '#2E7D32' : '#81C784'} 
          />
          <Text style={[
            styles.categoryButtonText,
            selectedCategory === category.key && styles.categoryButtonTextActive
          ]}>
            {category.label}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Text style={styles.header}>Sustainability Strategies</Text>
        
        {renderWeatherCard()}
        
        <View style={styles.notificationSection}>
          <View style={styles.notificationHeader}>
            <Text style={styles.notificationTitle}>Smart Notifications</Text>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: '#C8E6C9', true: '#4CAF50' }}
              thumbColor={notificationsEnabled ? '#2E7D32' : '#f4f3f4'}
            />
          </View>
          <Text style={styles.notificationDescription}>
            Get notified about weather conditions and receive irrigation recommendations
          </Text>
        </View>

        {renderCategoryFilter()}

        <View style={styles.tipsContainer}>
          <Text style={styles.tipsTitle}>Educational Guides</Text>
          {getFilteredTips().map((tip) => (
            <View key={tip.id} style={styles.tipCard}>
              <View style={styles.tipHeader}>
                <View style={[styles.tipIcon, { backgroundColor: getCategoryColor(tip.category) }]}>
                  <Ionicons name={tip.icon as any} size={20} color="white" />
                </View>
                <Text style={styles.tipTitle}>{tip.title}</Text>
              </View>
              <Text style={styles.tipDescription}>{tip.description}</Text>
            </View>
          ))}
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
    padding: 20,
  },
  header: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 20,
    textAlign: 'center',
  },
  weatherCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  weatherHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    justifyContent: 'space-between',
  },
  weatherTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2E7D32',
    marginLeft: 8,
    flex: 1,
  },
  locationStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF3E0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  locationStatusText: {
    fontSize: 12,
    color: '#F57C00',
    marginLeft: 4,
    fontWeight: '500',
  },
  weatherContent: {
    gap: 8,
  },
  weatherRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weatherLabel: {
    fontSize: 14,
    color: '#666',
  },
  weatherValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
  },
  forecastText: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 8,
  },
  irrigationStatus: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E0E0E0',
  },
  irrigationLabel: {
    fontSize: 14,
    color: '#666',
  },
  irrigationToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  irrigationText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2E7D32',
  },
  pausedText: {
    color: '#F57C00',
  },
  loadingText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  notificationSection: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  notificationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  notificationTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E7D32',
  },
  notificationDescription: {
    fontSize: 14,
    color: '#666',
  },
  categoryFilter: {
    marginBottom: 20,
  },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  categoryButtonActive: {
    backgroundColor: '#C8E6C9',
  },
  categoryButtonText: {
    fontSize: 14,
    color: '#81C784',
    marginLeft: 6,
    fontWeight: '500',
  },
  categoryButtonTextActive: {
    color: '#2E7D32',
    fontWeight: '600',
  },
  tipsContainer: {
    marginBottom: 20,
  },
  tipsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 16,
  },
  tipCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  tipIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  tipTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E7D32',
    flex: 1,
  },
  tipDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
});
