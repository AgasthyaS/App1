import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8F5E9',
    paddingTop: 40,
    paddingHorizontal: 20,
  },
  header: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2E7D32',
    textAlign: 'center',
    marginBottom: 30,
    borderBottomWidth: 1,
    borderBottomColor: '#C8E6C9',
    paddingBottom: 15,
  },
  menuItemsContainer: {
    marginTop: 10,
  },
  itemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#C8E6C9',
  },
  item: {
    fontSize: 18,
    color: '#2E7D32',
    marginLeft: 15,
  },
});

export default function Sidebar({ onClose }: { onClose: () => void }) {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Garden App</Text>
      
      <View style={styles.menuItemsContainer}>
        <TouchableOpacity
          style={styles.itemContainer}
          onPress={() => {
            onClose();
            router.push('/');
          }}
        >
          <Ionicons name="home" size={20} color="#2E7D32" />
          <Text style={styles.item}>Home</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.itemContainer}
          onPress={() => {
            onClose();
            router.push('/ai');
          }}
        >
          <Ionicons name="leaf" size={20} color="#2E7D32" />
          <Text style={styles.item}>Plant AI</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.itemContainer}
          onPress={() => {
            onClose();
            router.push('/calendar');
          }}
        >
          <Ionicons name="calendar" size={20} color="#2E7D32" />
          <Text style={styles.item}>Calendar</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.itemContainer}
          onPress={() => {
            onClose();
            router.push('/meta');
          }}
        >
          <Ionicons name="leaf" size={20} color="#2E7D32" />
          <Text style={styles.item}>Meta</Text>
        </TouchableOpacity>

      </View>
    </View>
  );
}