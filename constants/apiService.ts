import Groq from 'groq-sdk';

const groq = new Groq({
  apiKey: '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',
  dangerouslyAllowBrowser: true,
});

export async function sendMessageToBot(message) {
  console.debug('[sendMessageToBot] Called with message:', message);

  try {
    console.debug('[sendMessageToBot] Creating chat completion...');
    const response = await groq.chat.completions.create({
      messages: [
        {
          role: 'system',
          content: `You are a Plant expert named Herbie.  
          You answer only plant related questions.  
          You respond only to plant-related questions with clear, accurate, and practical information. 
          Keep replies concise and easy to understand, using bullet points or numbered lists when helpful—but adapt format to suit the question. 
          Use long paragraphs if needed; prioritize clarity and brevity. 
          Maintain a professional, informative tone that is approachable and helpful. 
          Focus on delivering actionable advice and solutions that users can apply confidently 
          also try to find out more specific details to give the user a better response.`,
        },
        {
          role: 'user',
          content: message,
        },
      ],
      model: 'llama3-8b-8192',
    });

    console.debug('[sendMessageToBot] Raw response:', response);

    const botReply = response.choices[0]?.message?.content || '';
    console.debug('[sendMessageToBot] Extracted bot reply:', botReply);

    return botReply;
  } catch (error) {
    console.error('[sendMessageToBot] Error sending message to bot:', error);
    throw error;
  }
}
