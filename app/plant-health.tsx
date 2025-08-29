import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import {
    Alert,
    Image,
    Modal,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface DiseaseInfo {
  id: string;
  name: string;
  description: string;
  symptoms: string[];
  treatments: string[];
  prevention: string[];
  severity: 'low' | 'medium' | 'high';
  image?: string;
}

const COMMON_DISEASES: DiseaseInfo[] = [
  {
    id: '1',
    name: 'Powdery Mildew',
    description: 'A fungal disease that appears as white or gray powdery spots on leaves.',
    symptoms: ['White powdery spots on leaves', 'Leaves may curl or distort', 'Stunted growth'],
    treatments: [
      'Remove infected leaves immediately',
      'Apply neem oil solution (1 tbsp neem oil + 1 tsp dish soap + 1 quart water)',
      'Improve air circulation around plants',
      'Avoid overhead watering'
    ],
    prevention: [
      'Plant resistant varieties',
      'Maintain proper spacing between plants',
      'Water at the base of plants',
      'Apply preventive neem oil treatments'
    ],
    severity: 'medium',
  },
  {
    id: '2',
    name: 'Aphid Infestation',
    description: 'Small, soft-bodied insects that feed on plant sap and can spread diseases.',
    symptoms: ['Clusters of small insects on stems and leaves', 'Sticky honeydew residue', 'Curled or yellowing leaves'],
    treatments: [
      'Spray with strong water stream to dislodge aphids',
      'Apply insecticidal soap (1 tbsp liquid soap + 1 quart water)',
      'Introduce beneficial insects like ladybugs',
      'Use neem oil spray'
    ],
    prevention: [
      'Regularly inspect plants for early signs',
      'Encourage beneficial insects with diverse plantings',
      'Avoid over-fertilizing with nitrogen',
      'Use row covers for vulnerable plants'
    ],
    severity: 'low',
  },
  {
    id: '3',
    name: 'Root Rot',
    description: 'A serious condition caused by overwatering and poor drainage.',
    symptoms: ['Yellowing leaves', 'Wilting despite adequate water', 'Soft, brown roots', 'Stunted growth'],
    treatments: [
      'Remove plant from soil and trim affected roots',
      'Repot in fresh, well-draining soil',
      'Reduce watering frequency',
      'Add perlite or sand to improve drainage'
    ],
    prevention: [
      'Use well-draining potting mix',
      'Ensure pots have drainage holes',
      'Water only when top inch of soil is dry',
      'Avoid overwatering'
    ],
    severity: 'high',
  },
  {
    id: '4',
    name: 'Spider Mites',
    description: 'Tiny arachnids that cause stippling and webbing on plant leaves.',
    symptoms: ['Fine webbing on leaves', 'Yellow or bronze stippling', 'Leaves may drop prematurely'],
    treatments: [
      'Spray with water to dislodge mites',
      'Apply neem oil or insecticidal soap',
      'Increase humidity around plants',
      'Use predatory mites for biological control'
    ],
    prevention: [
      'Regularly mist plants to increase humidity',
      'Inspect new plants before bringing indoors',
      'Keep plants well-watered but not overwatered',
      'Quarantine new plants for 2 weeks'
    ],
    severity: 'medium',
  },
];

export default function PlantHealthScreen() {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [symptoms, setSymptoms] = useState('');
  const [diagnosis, setDiagnosis] = useState<DiseaseInfo | null>(null);
  const [showDiagnosis, setShowDiagnosis] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const pickImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera roll permission is required to select images.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setSelectedImage(result.assets[0].uri);
        setDiagnosis(null);
      }
    } catch (error) {
      console.error('Error picking image:', error);
      Alert.alert('Error', 'Failed to select image. Please try again.');
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Camera permission is required to take photos.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setSelectedImage(result.assets[0].uri);
        setDiagnosis(null);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      Alert.alert('Error', 'Failed to take photo. Please try again.');
    }
  };

  const analyzePlant = () => {
    if (!selectedImage && !symptoms.trim()) {
      Alert.alert('Input Required', 'Please provide an image or describe the symptoms.');
      return;
    }

    setIsAnalyzing(true);
    
    // Simulate AI analysis
    setTimeout(() => {
      // In a real app, this would call an AI service for image analysis
      const randomDisease = COMMON_DISEASES[Math.floor(Math.random() * COMMON_DISEASES.length)];
      setDiagnosis(randomDisease);
      setShowDiagnosis(true);
      setIsAnalyzing(false);
    }, 2000);
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'low': return '#4CAF50';
      case 'medium': return '#FF9800';
      case 'high': return '#F44336';
      default: return '#757575';
    }
  };

  const getSeverityText = (severity: string) => {
    switch (severity) {
      case 'low': return 'Low Risk';
      case 'medium': return 'Medium Risk';
      case 'high': return 'High Risk';
      default: return 'Unknown';
    }
  };

  const renderImageSection = () => (
    <View style={styles.imageSection}>
      <Text style={styles.sectionTitle}>Upload Plant Image</Text>
      <Text style={styles.sectionDescription}>
        Take a photo or select an image of the affected plant for AI analysis
      </Text>
      
      <View style={styles.imageButtons}>
        <TouchableOpacity style={styles.imageButton} onPress={takePhoto}>
          <Ionicons name="camera" size={24} color="#2E7D32" />
          <Text style={styles.imageButtonText}>Take Photo</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.imageButton} onPress={pickImage}>
          <Ionicons name="images" size={24} color="#2E7D32" />
          <Text style={styles.imageButtonText}>Choose Image</Text>
        </TouchableOpacity>
      </View>

      {selectedImage && (
        <View style={styles.selectedImageContainer}>
          <Image source={{ uri: selectedImage }} style={styles.selectedImage} />
          <TouchableOpacity 
            style={styles.removeImageButton}
            onPress={() => setSelectedImage(null)}
          >
            <Ionicons name="close-circle" size={24} color="#F44336" />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderSymptomsSection = () => (
    <View style={styles.symptomsSection}>
      <Text style={styles.sectionTitle}>Describe Symptoms</Text>
      <Text style={styles.sectionDescription}>
        Provide additional details about what you're observing
      </Text>
      
      <TextInput
        style={styles.symptomsInput}
        placeholder="Describe the symptoms you're seeing (e.g., yellow leaves, spots, wilting)..."
        value={symptoms}
        onChangeText={setSymptoms}
        multiline
        numberOfLines={4}
        textAlignVertical="top"
      />
    </View>
  );

  const renderAnalysisButton = () => (
    <TouchableOpacity 
      style={[styles.analyzeButton, isAnalyzing && styles.analyzeButtonDisabled]}
      onPress={analyzePlant}
      disabled={isAnalyzing}
    >
      {isAnalyzing ? (
        <View style={styles.analyzingContainer}>
          <Ionicons name="refresh" size={20} color="white" style={styles.spinningIcon} />
          <Text style={styles.analyzeButtonText}>Analyzing...</Text>
        </View>
      ) : (
        <View style={styles.analyzeContainer}>
          <Ionicons name="search" size={20} color="white" />
          <Text style={styles.analyzeButtonText}>Analyze Plant Health</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderDiagnosisModal = () => (
    <Modal
      visible={showDiagnosis}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setShowDiagnosis(false)}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Diagnosis Results</Text>
            <TouchableOpacity onPress={() => setShowDiagnosis(false)}>
              <Ionicons name="close" size={24} color="#666" />
            </TouchableOpacity>
          </View>

          {diagnosis && (
            <ScrollView style={styles.diagnosisContent}>
              <View style={styles.diagnosisHeader}>
                <Text style={styles.diseaseName}>{diagnosis.name}</Text>
                <View style={[styles.severityBadge, { backgroundColor: getSeverityColor(diagnosis.severity) }]}>
                  <Text style={styles.severityText}>{getSeverityText(diagnosis.severity)}</Text>
                </View>
              </View>

              <Text style={styles.diseaseDescription}>{diagnosis.description}</Text>

              <View style={styles.diagnosisSection}>
                <Text style={styles.diagnosisSectionTitle}>Common Symptoms</Text>
                {diagnosis.symptoms.map((symptom, index) => (
                  <View key={index} style={styles.symptomItem}>
                    <Ionicons name="warning" size={16} color="#FF9800" />
                    <Text style={styles.symptomText}>{symptom}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.diagnosisSection}>
                <Text style={styles.diagnosisSectionTitle}>Chemical-Free Treatments</Text>
                {diagnosis.treatments.map((treatment, index) => (
                  <View key={index} style={styles.treatmentItem}>
                    <Ionicons name="leaf" size={16} color="#4CAF50" />
                    <Text style={styles.treatmentText}>{treatment}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.diagnosisSection}>
                <Text style={styles.diagnosisSectionTitle}>Prevention Tips</Text>
                {diagnosis.prevention.map((tip, index) => (
                  <View key={index} style={styles.preventionItem}>
                    <Ionicons name="shield-checkmark" size={16} color="#2196F3" />
                    <Text style={styles.preventionText}>{tip}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <Text style={styles.header}>Plant Health Diagnosis</Text>
        
        {renderImageSection()}
        {renderSymptomsSection()}
        {renderAnalysisButton()}
        {renderDiagnosisModal()}
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
  imageSection: {
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
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  imageButtons: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  imageButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F8E9',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C8E6C9',
  },
  imageButtonText: {
    fontSize: 14,
    color: '#2E7D32',
    marginLeft: 8,
    fontWeight: '500',
  },
  selectedImageContainer: {
    position: 'relative',
    alignItems: 'center',
  },
  selectedImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    resizeMode: 'cover',
  },
  removeImageButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'white',
    borderRadius: 12,
  },
  symptomsSection: {
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
  symptomsInput: {
    borderWidth: 1,
    borderColor: '#C8E6C9',
    borderRadius: 8,
    padding: 12,
    minHeight: 100,
    fontSize: 14,
    color: '#333',
  },
  analyzeButton: {
    backgroundColor: '#2E7D32',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  analyzeButtonDisabled: {
    backgroundColor: '#81C784',
  },
  analyzeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  analyzingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spinningIcon: {
    transform: [{ rotate: '360deg' }],
  },
  analyzeButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: 'white',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E7D32',
  },
  diagnosisContent: {
    padding: 20,
  },
  diagnosisHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  diseaseName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2E7D32',
    flex: 1,
  },
  severityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  severityText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  diseaseDescription: {
    fontSize: 16,
    color: '#666',
    lineHeight: 24,
    marginBottom: 20,
  },
  diagnosisSection: {
    marginBottom: 20,
  },
  diagnosisSectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 12,
  },
  symptomItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  symptomText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
    flex: 1,
    lineHeight: 20,
  },
  treatmentItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  treatmentText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
    flex: 1,
    lineHeight: 20,
  },
  preventionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  preventionText: {
    fontSize: 14,
    color: '#666',
    marginLeft: 8,
    flex: 1,
    lineHeight: 20,
  },
});
