import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: {
            backgroundColor: '#E8F5E9',
            borderTopWidth: 1,
            borderTopColor: '#C8E6C9',
            height: 80,
            paddingBottom: 10,
            paddingTop: 10,
          },
          tabBarActiveTintColor: '#2E7D32',
          tabBarInactiveTintColor: '#81C784',
          tabBarLabelStyle: {
            fontSize: 12,
            fontWeight: '600',
          },
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="home" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="ai"
          options={{
            title: 'Plant AI',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="leaf" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="calendar"
          options={{
            title: 'Calendar',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="calendar" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="meta"
          options={{
            title: 'About',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="information-circle" size={size} color={color} />
            ),
          }}
        />
      </Tabs>
    </SafeAreaProvider>
  );
}