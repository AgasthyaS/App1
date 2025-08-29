import { ChatBotComponent } from '@/components/ui/aiComponent';
import React from 'react';
import { StyleSheet } from 'react-native';

export default function Chatbot() {
  return (
    // <SafeAreaView style={styles.container}>
      <ChatBotComponent />
    // </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});