import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: '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', dangerouslyAllowBrowser: true });

export async function sendMessageToBot(message) {
  try {
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
Focus on delivering actionable advice and solutions that users can apply confidently also try to find out more specific details to give the user a better response.`,
        },
        {
          role: 'user',
          content: message,
        },
      ],
      model: 'llama3-8b-8192',
    });

    return response.choices[0]?.message?.content || '';
  } catch (error) {
    console.error('Error sending message to bot:', error);
    throw error;
  }
}
