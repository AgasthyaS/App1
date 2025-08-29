import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const Meta = () => {
  return (
    <SafeAreaView style={styles.mainContainer}>
      <ScrollView style={styles.container}>
        <View style={styles.section}>
          <Text style={styles.title}>Our Mission</Text>
          <Text style={styles.content}>
            Our mission is to empower gardeners by providing innovative tools and knowledge, enabling them to create and nurture thriving gardens. By promoting a love for gardening and fostering sustainable practices, we aim to help communities cultivate their own beautiful, eco-friendly oasis.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.title}>About Us</Text>
          <Text style={styles.content}>
            I am a passionate individual who loves gardening, technology, and nature. My goal is to create a gardening app that supports users in cultivating their dream gardens and fosters a sense of community.
            In my spare time, I enjoy staying active through swimming and playing basketball with friends. I believe that my interests and experiences will help me develop a gardening app that empowers gardeners worldwide.
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.title}>FAQs</Text>

          <View style={styles.qaBlock}>
            <Text style={styles.question}>Q: How do I contact support?</Text>
            <Text style={styles.answer}>A: You can email me at agasthya.shukla@gmail.com</Text>
          </View>

          <View style={styles.qaBlock}>
            <Text style={styles.question}>Q: What platforms do you support?</Text>
            <Text style={styles.answer}>A: We develop for both iOS and Android</Text>
          </View>

          <View style={styles.qaBlock}>
            <Text style={styles.question}>Q: What are the core features of the app?</Text>
            <Text style={styles.answer}>A: The core feature of the app is the planting calendar, which suggests the right plants for particular contexts (time of the year, plant type) and allows users to track plant growth.</Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#E8F5E9',
  },
  section: {
    marginBottom: 30,
    backgroundColor: '#ffffff',
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#2c3e50',
    marginBottom: 12,
    borderBottomWidth: 2,
    borderBottomColor: '#4CAF50',
    paddingBottom: 4,
  },
  content: {
    fontSize: 16,
    lineHeight: 24,
    color: '#34495e',
  },
  qaBlock: {
    marginTop: 10,
    padding: 8,
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
  },
  question: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2d3436',
    marginBottom: 4,
  },
  answer: {
    fontSize: 15,
    color: '#636e72',
    paddingLeft: 10,
  },
});

export default Meta;