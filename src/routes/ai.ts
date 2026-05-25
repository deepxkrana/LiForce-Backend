import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

// Initialize Claude Client (requires ANTHROPIC_API_KEY in .env)
const apiKey = process.env.ANTHROPIC_API_KEY || 'dummy_key';
let anthropic: Anthropic | null = null;

if (apiKey !== 'dummy_key') {
  try {
    anthropic = new Anthropic({ apiKey });
  } catch (err) {
    console.error('⚠️ Failed to initialize Anthropic client:', err);
  }
}

// POST: Chatbot endpoint
router.post('/ai/chat', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    // Smart Fallback offline system if no real API key is set or if key is invalid
    if (!anthropic || apiKey === 'dummy_key') {
      const lastUserMsg = messages[messages.length - 1]?.content || '';
      console.log(`🤖 [OFFLINE BOT FALLBACK] Received: "${lastUserMsg}"`);

      let reply = 'I am your LiForce AI Assistant. How can I help you save lives today?';
      const cleanMsg = lastUserMsg.toLowerCase();

      if (cleanMsg.includes('eligib') || cleanMsg.includes('can i')) {
        reply = 'Generally, to donate blood you must be between 18-65 years old, weigh at least 50kg, and be in good general health. Women can donate every 4 months, and men every 3 months. Let me know if you have specific medical conditions!';
      } else if (cleanMsg.includes('hello') || cleanMsg.includes('hi')) {
        reply = 'Hello! I am LiForce AI, your empathetic companion. I can guide you through donation eligibility, finding nearby camps, or setting up emergency SOS requests. How are you today?';
      } else if (cleanMsg.includes('sos') || cleanMsg.includes('emergency') || cleanMsg.includes('need blood')) {
        reply = 'If you need blood urgently, please use our "SOS Emergency" broadcast form! It matches your request with nearby donors within a 15km radius instantly and sends real-time pushes.';
      } else if (cleanMsg.includes('camp') || cleanMsg.includes('event')) {
        reply = 'You can browse upcoming blood donation camps on our "Community" tab! Seeded events like the Summer Donation Camp at Sukhna Lake Chandigarh are currently active.';
      } else if (cleanMsg.includes('points') || cleanMsg.includes('reward')) {
        reply = 'Every successful donation earns you points! 100 points are awarded upon completing your donation appointments. You can level up to Gold and Diamond status badges!';
      }

      return res.json({ reply });
    }

    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 300,
      system: 'You are LiForce AI, a helpful and empathetic assistant for a blood donation platform. Provide short, concise, and accurate answers regarding blood donation eligibility, process, and emergency help.',
      messages: messages,
    });

    const replyText = response.content[0].type === 'text' 
      ? response.content[0].text 
      : 'I am unable to respond right now.';

    return res.json({ reply: replyText });
  } catch (error) {
    console.error('Claude API Error, triggering fallback:', error);
    // Graceful fallback on API error
    return res.json({ 
      reply: 'I am currently running in offline helper mode. You can donate blood if you are healthy, weigh over 50kg, and are aged 18-65. For urgent help, please trigger an SOS alert!' 
    });
  }
});

export default router;
