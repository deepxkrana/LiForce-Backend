import { Router, Request, Response } from 'express';

const router = Router();

const SYSTEM_PROMPT = `You are LiForce AI, a helpful, empathetic, and strictly focused assistant for the LiForce blood donation platform. 
Your ONLY purpose is to answer questions about blood donation, eligibility, finding camps, emergency SOS requests, and the LiForce platform itself. 

KNOWLEDGE BASE ABOUT LIFORCE:
- What is LiForce: It is a modern, real-time blood donation platform that bridges the gap between voluntary blood donors, blood banks, and patients in critical need. Its motto is "Every drop counts."
- Emergency SOS: Users can broadcast urgent blood requests. The system uses Haversine distance geolocation to instantly alert donors within a 50km radius and blood banks within a 200km radius.
- Blood Banks: They can register, manage their live blood inventory, and accept voluntary donations from users.
- Rewards & Gamification: To encourage donations, users earn 100 Reward Points for every successful donation. They can climb the Leaderboard and earn status badges (like Gold or Diamond).
- Community Camps: Users can view and join upcoming local blood donation drives or camps.
- General Eligibility: Donors must generally be 18-65 years old, weigh at least 50kg, and be in good health. Men can donate every 3 months, and women every 4 months (or 56 days generally in some regions). 

IMPORTANT FORMATTING RULES:
- NEVER use Markdown formatting.
- Do NOT use asterisks (**) for bold text or bullet points.
- Output ONLY plain, readable text. Use standard numbers (1., 2.) for lists if necessary.

If a user asks about anything unrelated to blood donation, medicine, or the platform (e.g., coding, politics, recipes, general chat), politely refuse and steer the conversation back to how they can save lives using LiForce. Keep your answers concise, accurate, and encouraging.`;

// POST: Chatbot endpoint
router.post('/ai/chat', async (req: Request, res: Response) => {
  try {
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    // Smart Fallback offline system if no real API key is set
    if (!apiKey || apiKey === 'dummy_key') {
      const lastUserMsg = messages[messages.length - 1]?.content || '';
      console.log(`🤖 [OFFLINE BOT FALLBACK] Received: "${lastUserMsg}"`);

      let reply = 'I am your LiForce AI Assistant. How can I help you save lives today?';
      const cleanMsg = lastUserMsg.toLowerCase();

      if (cleanMsg.includes('eligib') || cleanMsg.includes('can i')) {
        reply = 'Generally, to donate blood you must be between 18-65 years old, weigh at least 50kg, and be in good general health. Let me know if you have specific medical conditions!';
      } else if (cleanMsg.includes('hello') || cleanMsg.includes('hi')) {
        reply = 'Hello! I am LiForce AI. I can guide you through donation eligibility, finding nearby camps, or setting up emergency SOS requests.';
      } else if (cleanMsg.includes('sos') || cleanMsg.includes('emergency')) {
        reply = 'If you need blood urgently, please use our "SOS Emergency" broadcast form!';
      } else if (cleanMsg.includes('camp') || cleanMsg.includes('event')) {
        reply = 'You can browse upcoming blood donation camps on our "Community" tab!';
      } else if (cleanMsg.includes('points') || cleanMsg.includes('reward')) {
        reply = 'Every successful donation earns you 100 points! You can level up to Gold and Diamond status badges!';
      }

      return res.json({ reply });
    }

    // Call Gemini API using native fetch
    const geminiMessages = messages.map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: SYSTEM_PROMPT }]
        },
        contents: geminiMessages,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 300
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API Error: ${response.statusText}`);
    }

    const data = await response.json();
    const replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || 'I am unable to respond right now.';

    return res.json({ reply: replyText });
  } catch (error) {
    console.error('Gemini API Error, triggering fallback:', error);
    return res.json({ 
      reply: 'I am currently running in offline helper mode because I could not connect to the AI brain. You can donate blood if you are healthy, weigh over 50kg, and are aged 18-65. For urgent help, please trigger an SOS alert!' 
    });
  }
});

export default router;
