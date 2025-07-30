import { ChatBotComponent } from '@/components/ui/aiComponent';
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Drawer } from 'react-native-drawer-layout';
import Sidebar from '../components/Sidebar';

export default function Chatbot() {
  const [open, setOpen] = useState(false);

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
        
        <ChatBotComponent />
      </View>
    </Drawer>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  menuButton: {
    position: 'absolute',
    top: 25,
    left: 16,
    zIndex: 1,
    padding: 8,
  },
});