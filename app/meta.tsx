import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

const Meta = () => {
  const handleEmailPress = () => {
    Linking.openURL('mailto:agasthya.shukla@gmail.com');
  };

  const handleWebsitePress = () => {
    Linking.openURL('https://github.com/yourusername/garden-app');
  };

  return (
    // <SafeAreaView style={styles.mainContainer}>
      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <View style={styles.heroIcon}>
            <Ionicons name="leaf" size={48} color="#2E7D32" />
          </View>
          <Text style={styles.heroTitle}>Garden App</Text>
          <Text style={styles.heroSubtitle}>Cultivating Digital Gardens</Text>
        </View>

        {/* Mission Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="compass" size={24} color="#2E7D32" />
            <Text style={styles.sectionTitle}>Our Mission</Text>
          </View>
          <Text style={styles.sectionContent}>
            Our mission is to empower gardeners by providing innovative tools and knowledge, enabling them to create and nurture thriving gardens. By promoting a love for gardening and fostering sustainable practices, we aim to help communities cultivate their own beautiful, eco-friendly oasis.
          </Text>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person" size={24} color="#2E7D32" />
            <Text style={styles.sectionTitle}>About the Developer</Text>
          </View>
          <Text style={styles.sectionContent}>
            I am a passionate individual who loves gardening, technology, and nature. My goal is to create a gardening app that supports users in cultivating their dream gardens and fosters a sense of community.
          </Text>
          <Text style={styles.sectionContent}>
            In my spare time, I enjoy staying active through swimming and playing basketball with friends. I believe that my interests and experiences will help me develop a gardening app that empowers gardeners worldwide.
          </Text>
        </View>

        {/* Features Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="star" size={24} color="#2E7D32" />
            <Text style={styles.sectionTitle}>Core Features</Text>
          </View>
          <View style={styles.featuresList}>
            <View style={styles.featureItem}>
              <Ionicons name="calendar" size={20} color="#4CAF50" />
              <Text style={styles.featureText}>Smart Planting Calendar</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="leaf" size={20} color="#4CAF50" />
              <Text style={styles.featureText}>AI Plant Identification</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="medical" size={20} color="#4CAF50" />
              <Text style={styles.featureText}>Disease Diagnosis</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="water" size={20} color="#4CAF50" />
              <Text style={styles.featureText}>Sustainability Guides</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="location" size={20} color="#4CAF50" />
              <Text style={styles.featureText}>Location-Based Tips</Text>
            </View>
          </View>
        </View>

        {/* FAQs Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="help-circle" size={24} color="#2E7D32" />
            <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          </View>
          
          <View style={styles.faqContainer}>
            <View style={styles.faqItem}>
              <View style={styles.faqQuestion}>
                <Ionicons name="mail" size={16} color="#FF9800" />
                <Text style={styles.faqQuestionText}>How do I contact support?</Text>
              </View>
              <Text style={styles.faqAnswer}>
                You can email me directly at{' '}
                <Text style={styles.linkText} onPress={handleEmailPress}>
                  agasthya.shukla@gmail.com
                </Text>
              </Text>
            </View>

            <View style={styles.faqItem}>
              <View style={styles.faqQuestion}>
                <Ionicons name="phone-portrait" size={16} color="#FF9800" />
                <Text style={styles.faqQuestionText}>What platforms do you support?</Text>
              </View>
              <Text style={styles.faqAnswer}>
                We develop for both iOS and Android, ensuring a consistent experience across all devices.
              </Text>
            </View>

            <View style={styles.faqItem}>
              <View style={styles.faqQuestion}>
                <Ionicons name="leaf" size={16} color="#FF9800" />
                <Text style={styles.faqQuestionText}>What are the core features?</Text>
              </View>
              <Text style={styles.faqAnswer}>
                The core features include a smart planting calendar, AI-powered plant identification, disease diagnosis, sustainability guides, and location-based gardening recommendations.
              </Text>
            </View>
          </View>
        </View>

        {/* Contact Section */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="chatbubbles" size={24} color="#2E7D32" />
            <Text style={styles.sectionTitle}>Get in Touch</Text>
          </View>
          <View style={styles.contactButtons}>
            <TouchableOpacity style={styles.contactButton} onPress={handleEmailPress}>
              <Ionicons name="mail" size={20} color="white" />
              <Text style={styles.contactButtonText}>Email Support</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.contactButton} onPress={handleWebsitePress}>
              <Ionicons name="globe" size={20} color="white" />
              <Text style={styles.contactButtonText}>Visit Website</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Made with ❤️ for gardeners everywhere</Text>
          <Text style={styles.versionText}>Version 1.0.0</Text>
        </View>
      </ScrollView>
    // </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: '#E8F5E9',
  },
  heroSection: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
    backgroundColor: 'white',
    margin: 20,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
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
    fontSize: 32,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 16,
    color: '#666',
    fontStyle: 'italic',
  },
  section: {
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginLeft: 12,
  },
  sectionContent: {
    fontSize: 16,
    lineHeight: 24,
    color: '#444',
    marginBottom: 12,
  },
  featuresList: {
    gap: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  featureText: {
    fontSize: 16,
    color: '#444',
    marginLeft: 12,
    fontWeight: '500',
  },
  faqContainer: {
    gap: 16,
  },
  faqItem: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
  },
  faqQuestion: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  faqQuestionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#2E7D32',
    marginLeft: 8,
  },
  faqAnswer: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
    paddingLeft: 24,
  },
  linkText: {
    color: '#2196F3',
    textDecorationLine: 'underline',
  },
  contactButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  contactButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2E7D32',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  contactButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  footerText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 8,
  },
  versionText: {
    fontSize: 12,
    color: '#999',
  },
});

export default Meta;