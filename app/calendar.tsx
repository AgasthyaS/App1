import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Animated,
  Dimensions,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { Calendar, LocaleConfig } from 'react-native-calendars';

// Configure calendar locale
LocaleConfig.locales['en'] = {
  monthNames: [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ],
  dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  dayNamesShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  today: 'Today'
};
LocaleConfig.defaultLocale = 'en';

type Task = {
  id: string;
  text: string;
  completed: boolean;
};

type ConfettiPiece = {
  id: number;
  left: number;
  top: Animated.Value;
  rotation: Animated.Value;
  color: string;
  opacity: Animated.Value;
  size: number;
};

const { width, height } = Dimensions.get('window');
const COLORS = ['#2E7D32', '#4CAF50', '#81C784', '#A5D6A7', '#C8E6C9'];

// Array of sample gardening tasks
const GARDENING_TASKS = [
  "Water plants",
  "Check soil moisture",
  "Inspect for pests",
  "Prune shrubs",
  "Weed garden beds",
  "Fertilize plants",
  "Harvest vegetables",
  "Plant new seeds",
  "Mulch garden",
  "Trim hedges",
  "Clean garden tools",
  "Monitor plant growth",
  "Remove dead leaves",
  "Stake tall plants",
  "Divide perennials",
  "Check irrigation system",
  "Apply compost",
  "Monitor for diseases",
  "Rotate potted plants",
  "Clean greenhouse"
];

// Function to generate random tasks for a whole year
const generateYearlyTasks = () => {
  const tasks: Record<string, Task[]> = {};
  const startDate = new Date();
  startDate.setMonth(0, 1); // January 1st of current year
  const endDate = new Date();
  endDate.setMonth(11, 31); // December 31st of current year

  for (let date = new Date(startDate); date <= endDate; date.setDate(date.getDate() + 1)) {
    const dateString = date.toISOString().split('T')[0];
    const taskCount = 2 + Math.floor(Math.random() * 2); // 2-3 tasks per day
    const dailyTasks: Task[] = [];

    for (let i = 0; i < taskCount; i++) {
      const randomTaskIndex = Math.floor(Math.random() * GARDENING_TASKS.length);
      dailyTasks.push({
        id: `${dateString}-${i}`,
        text: GARDENING_TASKS[randomTaskIndex],
        completed: false
      });
    }

    tasks[dateString] = dailyTasks;
  }

  return tasks;
};

export default function CalendarScreen() {
  const now = new Date();
  const currentDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [isAddModalVisible, setAddModalVisible] = useState(false);
  const [isEditModalVisible, setEditModalVisible] = useState(false);
  const [newTaskDate, setNewTaskDate] = useState(currentDate);
  const [newTaskText, setNewTaskText] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);
  const bounceAnim = new Animated.Value(1);
  
  // Initialize with tasks for every day of the year
  const [tasks, setTasks] = useState<Record<string, Task[]>>(() => generateYearlyTasks());

  useEffect(() => {
    // Check if all tasks are completed when tasks change
    const currentTasks = tasks[selectedDate] || [];
    if (currentTasks.length > 0 && currentTasks.every(task => task.completed)) {
      triggerConfetti();
    }
  }, [tasks, selectedDate]);

  const triggerConfetti = () => {
    const pieces = Array.from({ length: 75 }, (_, i) => {
      const top = new Animated.Value(-20);
      const rotation = new Animated.Value(Math.random() * 360);
      const opacity = new Animated.Value(1);
      const size = 6 + Math.random() * 6;
      
      // Slower animation (5000ms duration)
      Animated.sequence([
        Animated.timing(top, {
          toValue: height + 20,
          duration: 5000 + Math.random() * 2000,
          easing: Easing.linear,
          useNativeDriver: true
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true
        })
      ]).start();
      
      // Rotation animation
      Animated.loop(
        Animated.timing(rotation, {
          toValue: 360,
          duration: 3000 + Math.random() * 4000,
          easing: Easing.linear,
          useNativeDriver: true
        })
      ).start();
      
      return {
        id: i,
        left: Math.random() * width,
        top,
        rotation,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        opacity,
        size
      };
    });
    
    setConfettiPieces(pieces);
    animateButton();
    
    setTimeout(() => {
      setConfettiPieces([]);
    }, 5500);
  };

  const animateButton = () => {
    bounceAnim.setValue(1);
    Animated.sequence([
      Animated.timing(bounceAnim, {
        toValue: 1.2,
        duration: 200,
        easing: Easing.linear,
        useNativeDriver: true
      }),
      Animated.spring(bounceAnim, {
        toValue: 1,
        friction: 3,
        useNativeDriver: true
      })
    ]).start();
  };

  const formatDisplayDate = (dateString: string) => {
    const date = new Date(dateString + 'T12:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
  };

  const handleAddTask = () => {
    if (!newTaskText.trim()) {
      Alert.alert('Error', 'Please enter a task description');
      return;
    }

    setTasks(prevTasks => {
      const existingTasks = prevTasks[newTaskDate] || [];
      return {
        ...prevTasks,
        [newTaskDate]: [...existingTasks, { 
          id: `${newTaskDate}-${Date.now()}`, 
          text: newTaskText, 
          completed: false 
        }]
      };
    });

    setNewTaskText('');
    setAddModalVisible(false);
  };

  const handleEditTask = () => {
    if (!editingTask || !newTaskText.trim()) {
      Alert.alert('Error', 'Please enter a task description');
      return;
    }

    setTasks(prevTasks => {
      const dateTasks = [...prevTasks[selectedDate]];
      const taskIndex = dateTasks.findIndex(t => t.id === editingTask.id);
      if (taskIndex !== -1) {
        dateTasks[taskIndex] = { ...dateTasks[taskIndex], text: newTaskText };
      }
      return {
        ...prevTasks,
        [selectedDate]: dateTasks
      };
    });

    setNewTaskText('');
    setEditModalVisible(false);
  };

  const toggleTaskCompletion = (taskId: string) => {
    setTasks(prevTasks => {
      const dateTasks = [...prevTasks[selectedDate]];
      const taskIndex = dateTasks.findIndex(t => t.id === taskId);
      if (taskIndex !== -1) {
        dateTasks[taskIndex] = { 
          ...dateTasks[taskIndex], 
          completed: !dateTasks[taskIndex].completed 
        };
      }
      return {
        ...prevTasks,
        [selectedDate]: dateTasks
      };
    });
  };

  const openAddModal = () => {
    setNewTaskDate(selectedDate);
    setAddModalVisible(true);
  };

  const openEditModal = (task: Task) => {
    setEditingTask(task);
    setNewTaskText(task.text);
    setEditModalVisible(true);
  };

  const deleteTask = (taskId: string) => {
    setTasks(prevTasks => {
      const dateTasks = prevTasks[selectedDate].filter(t => t.id !== taskId);
      return {
        ...prevTasks,
        [selectedDate]: dateTasks
      };
    });
  };

  return (
    <>
      {/* Confetti (positioned absolutely but behind calendar) */}
      {confettiPieces.map((piece) => (
        <Animated.View
          key={piece.id}
          style={[
            styles.confettiPiece,
            {
              left: piece.left,
              width: piece.size,
              height: piece.size,
              borderRadius: piece.size / 2,
              transform: [
                { translateY: piece.top },
                { rotate: piece.rotation.interpolate({
                  inputRange: [0, 360],
                  outputRange: ['0deg', '360deg']
                })},
              ],
              backgroundColor: piece.color,
              opacity: piece.opacity,
              zIndex: 1, // Behind calendar but above background
            }
          ]}
        />
      ))}
        
        {/* Calendar (positioned above confetti) */}
        <View style={{ zIndex: 2 }}>
          <Text style={styles.header}>Garden Calendar</Text>
          
          <Calendar
            style={styles.calendar}
            current={currentDate}
            markedDates={{
              [selectedDate]: { selected: true, selectedColor: '#2E7D32' },
              ...Object.keys(tasks).reduce((acc, date) => {
                const hasCompletedTasks = tasks[date].some(task => task.completed);
                const hasPendingTasks = tasks[date].some(task => !task.completed);
                
                if (hasCompletedTasks && hasPendingTasks) {
                  acc[date] = { marked: true, dots: [
                    { key: 'completed', color: '#81C784' },
                    { key: 'pending', color: '#FFA000' }
                  ]};
                } else if (hasCompletedTasks) {
                  acc[date] = { marked: true, dotColor: '#81C784' };
                } else {
                  acc[date] = { marked: true, dotColor: '#FFA000' };
                }
                return acc;
              }, {} as Record<string, any>)
            }}
            onDayPress={(day) => setSelectedDate(day.dateString)}
            theme={{
              backgroundColor: '#E8F5E9',
              calendarBackground: '#E8F5E9',
              selectedDayBackgroundColor: '#2E7D32',
              todayTextColor: '#2E7D32',
              arrowColor: '#2E7D32',
            }}
          />
        </View>

        <ScrollView style={[styles.tasksContainer, { zIndex: 2 }]}>
          <Text style={styles.dateHeader}>
            Tasks for {formatDisplayDate(selectedDate)}
          </Text>
          
          {tasks[selectedDate] ? (
            tasks[selectedDate].map((task) => (
              <TouchableOpacity 
                key={task.id} 
                style={[
                  styles.taskItem,
                  task.completed && styles.completedTask
                ]}
                onPress={() => toggleTaskCompletion(task.id)}
                onLongPress={() => openEditModal(task)}
              >
                <View style={[
                  styles.bulletPoint,
                  task.completed && styles.completedBullet
                ]} />
                <Text style={[
                  styles.taskText,
                  task.completed && styles.completedTaskText
                ]}>
                  {task.text}
                </Text>
                {task.completed && (
                  <Ionicons 
                    name="checkmark-circle" 
                    size={20} 
                    color="#81C784" 
                    style={styles.completedIcon} 
                  />
                )}
                <TouchableOpacity 
                  style={styles.deleteButton}
                  onPress={() => deleteTask(task.id)}
                >
                  <Ionicons name="trash-outline" size={18} color="#e57373" />
                </TouchableOpacity>
              </TouchableOpacity>
            ))
          ) : (
            <Text style={styles.noTasks}>No tasks scheduled</Text>
          )}
        </ScrollView>

        <Animated.View style={{ transform: [{ scale: bounceAnim }], zIndex: 3 }}>
          <TouchableOpacity style={styles.addButton} onPress={openAddModal}>
            <Ionicons name="add" size={32} color="white" />
          </TouchableOpacity>
        </Animated.View>

        {/* Add Task Modal */}
        <Modal
          visible={isAddModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setAddModalVisible(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Add New Task</Text>
              
              <Text style={styles.modalLabel}>Date:</Text>
              <TouchableOpacity 
                style={styles.dateInput} 
                onPress={() => {
                  // Here you could implement a date picker if needed
                }}
              >
                <Text>{formatDisplayDate(newTaskDate)}</Text>
              </TouchableOpacity>
              
              <Text style={styles.modalLabel}>Task Description:</Text>
              <TextInput
                style={styles.taskInput}
                multiline
                placeholder="What needs to be done?"
                value={newTaskText}
                onChangeText={setNewTaskText}
              />
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => setAddModalVisible(false)}
                >
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.modalButton, styles.addButtonModal]}
                  onPress={handleAddTask}
                >
                  <Text style={styles.buttonText}>Add Task</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Edit Task Modal */}
        <Modal
          visible={isEditModalVisible}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setEditModalVisible(false)}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Edit Task</Text>
              
              <Text style={styles.modalLabel}>Task Description:</Text>
              <TextInput
                style={styles.taskInput}
                multiline
                placeholder="Edit your task"
                value={newTaskText}
                onChangeText={setNewTaskText}
              />
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={[styles.modalButton, styles.deleteButtonModal]}
                  onPress={() => {
                    if (editingTask) {
                      deleteTask(editingTask.id);
                      setEditModalVisible(false);
                    }
                  }}
                >
                  <Text style={styles.buttonText}>Delete</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => setEditModalVisible(false)}
                >
                  <Text style={styles.buttonText}>Cancel</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.modalButton, styles.saveButtonModal]}
                  onPress={handleEditTask}
                >
                  <Text style={styles.buttonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#E8F5E9',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#2E7D32',
    textAlign: 'center',
    marginBottom: 10,
  },
  calendar: {
    marginBottom: 20,
    borderRadius: 10,
    overflow: 'hidden',
  },
  tasksContainer: {
    paddingHorizontal: 20,
    marginTop: 10,
    marginBottom: 80,
  },
  dateHeader: {
    fontSize: 18,
    fontWeight: '600',
    color: '#2E7D32',
    marginBottom: 15,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    elevation: 2,
  },
  completedTask: {
    backgroundColor: '#F1F8E9',
  },
  bulletPoint: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2E7D32',
    marginRight: 10,
  },
  completedBullet: {
    backgroundColor: '#81C784',
  },
  taskText: {
    fontSize: 16,
    color: '#2E7D32',
    flex: 1,
  },
  completedTaskText: {
    textDecorationLine: 'line-through',
    color: '#81C784',
  },
  completedIcon: {
    marginLeft: 10,
  },
  deleteButton: {
    marginLeft: 10,
    padding: 5,
  },
  noTasks: {
    fontSize: 16,
    color: '#81C784',
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 10,
  },

  addButton: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#2E7D32',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '90%',
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 10,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalLabel: {
    fontSize: 16,
    color: '#2E7D32',
    marginBottom: 5,
    fontWeight: '500',
  },
  dateInput: {
    borderWidth: 1,
    borderColor: '#81C784',
    borderRadius: 8,
    padding: 12,
    marginBottom: 15,
  },
  taskInput: {
    borderWidth: 1,
    borderColor: '#81C784',
    borderRadius: 8,
    padding: 12,
    minHeight: 100,
    marginBottom: 20,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalButton: {
    padding: 12,
    borderRadius: 8,
    width: '30%',
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: '#e0e0e0',
  },
  deleteButtonModal: {
    backgroundColor: '#e57373',
  },
  addButtonModal: {
    backgroundColor: '#2E7D32',
  },
  saveButtonModal: {
    backgroundColor: '#2196F3',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  confettiPiece: {
    position: 'absolute',
  },
});