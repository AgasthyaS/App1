import { sendMessageToBot } from '@/constants/apiService';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native'; // added View
import { GiftedChat } from 'react-native-gifted-chat';

const BOT_AVATAR = 'https://cdn-icons-png.freepik.com/512/7101/7101338.png'

export function ChatBotComponent() {
  const [messages, setMessages] = useState([])

  useEffect(() => {
    setMessages([
      {
        _id: 1,
        text: 'Hello, I am your personal Plant Assistant! Ask me questions for your garden!',
        createdAt: new Date(),
        user: {
          _id: 2,
          name: 'Plant Bot',
          avatar: BOT_AVATAR,
        },
      },
    ])
  }, [])

  const onSend = useCallback(async (newMessages = []) => {
    setMessages(prevMessages => GiftedChat.append(prevMessages, newMessages))

    const userMessage = newMessages[0].text

    try {
      const botReplyText = await sendMessageToBot(userMessage)

      const botMessage = {
        _id: Math.random().toString(36).substring(7),
        text: botReplyText,
        createdAt: new Date(),
        user: {
          _id: 2,
          name: 'Messi Bot',
          avatar: BOT_AVATAR,
        },
      }

      setMessages(prevMessages => GiftedChat.append(prevMessages, [botMessage]))
    } catch (err) {
      console.error('Bot error:', err)
    }
  }, [])

  return (
    <View style={{ backgroundColor: '#E8F5E9', flex: 1}}>
      <GiftedChat
        messages={messages}
        onSend={messages => onSend(messages)}
        user={{
          _id: 1,
          name: 'You',
        }}
      />
    </View>
  )
}
