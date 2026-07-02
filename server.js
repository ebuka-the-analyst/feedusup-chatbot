import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import OpenAI from "openai";

dotenv.config();

const app = express();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim());

const models = [
  process.env.OPENAI_MODEL_PRIMARY || "gpt-5.2",
  process.env.OPENAI_MODEL_SECONDARY || "gpt-5.2-chat-latest",
  process.env.OPENAI_MODEL_FALLBACK || "gpt-5-mini"
];

app.use(express.json({ limit: "1mb" }));

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  }
}));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    error: "Too many messages. Please try again shortly."
  }
}));

const SYSTEM_PROMPT = `
You are the Feed Us Up CIC website assistant.

Feed Us Up CIC supports vulnerable communities through practical action.
The organisation helps with food, groceries, essential resources, equipment, tools, volunteering and partnerships.

Main areas:
- UK: supporting elderly and isolated people with food, groceries and essential household items.
- Haiti: supporting schools, hospitals, churches and community organisations with supplies.

You help users with:
- donating money
- donating food, items or equipment
- volunteering
- company partnerships
- general questions
- contact direction

Rules:
- Be warm, short and clear.
- Do not invent bank details.
- Do not promise support is guaranteed.
- Do not give medical, legal or financial advice.
- If unsure, direct users to the Feed Us Up team.
- For contact, send users to https://feedusup.org.uk/pages/contact
`;

async function generateReply(message, history) {
  const recentHistory = history
    .slice(-8)
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");

  let lastError;

  for (const model of models) {
    try {
      const response = await openai.responses.create({
        model,
        instructions: SYSTEM_PROMPT,
        input: `
Previous conversation:
${recentHistory || "None"}

User message:
${message}
        `,
        max_output_tokens: 350
      });

      return {
        reply: response.output_text || "Sorry, I could not answer that.",
        model
      };
    } catch (error) {
      lastError = error;
      console.error(`Model failed: ${model}`, error.message);
    }
  }

  throw lastError;
}

app.get("/", (req, res) => {
  res.json({
    status: "Feed Us Up chatbot backend is running",
    models
  });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required"
      });
    }

    const result = await generateReply(message, history);

    res.json({
      reply: result.reply,
      model: result.model
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Chatbot unavailable. Please try again later."
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Feed Us Up chatbot running on port ${port}`);
});