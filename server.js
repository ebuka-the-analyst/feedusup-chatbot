import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";
import fs from "fs";

dotenv.config();

const app = express();

app.set("trust proxy", 1);

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const models = [
  process.env.OPENAI_MODEL_PRIMARY || "gpt-5-mini",
  process.env.OPENAI_MODEL_SECONDARY || "gpt-5-mini",
  process.env.OPENAI_MODEL_FALLBACK || "gpt-5-mini"
];

function loadFaqKnowledge() {
  try {
    const rawFaq = fs.readFileSync("./faq.json", "utf8");
    const faqs = JSON.parse(rawFaq);

    return faqs
      .map((item, index) => {
        return `${index + 1}. Q: ${item.question}\nA: ${item.answer}`;
      })
      .join("\n\n");
  } catch (error) {
    console.error("FAQ file could not be loaded:", error.message);
    return "";
  }
}

const FAQ_KNOWLEDGE = loadFaqKnowledge();

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
  standardHeaders: true,
  legacyHeaders: false
}));

const SYSTEM_PROMPT = `
You are the Feed Us Up CIC website assistant.

Use this approved FAQ knowledge base when answering:
${FAQ_KNOWLEDGE}

Feed Us Up CIC supports vulnerable communities through practical action, food support, donated resources, volunteering and partnerships.

Main areas:
1. UK support for elderly and isolated people with food, groceries and essential household items.
2. Haiti support for schools, hospitals, churches and community organisations with supplies.

Answer rules:
1. Keep every answer concise, maximum 55 words.
2. Use simple plain English.
3. Do not use markdown.
4. Do not use asterisks.
5. Do not use headings.
6. Do not use long dashes.
7. Do not use em dash or en dash.
8. Use normal punctuation only.
9. If listing items, use short numbered lines.
10. Do not invent bank details.
11. Do not promise support is guaranteed.
12. Do not give medical, legal or financial advice.
13. If unsure, direct users to https://feedusup.org.uk/pages/contact

For volunteering:
Ask them to share their location, availability and preferred area of support through the contact page.

For donations:
Tell them they can donate money, food, items or equipment. Direct them to the donation or contact page.

For partnerships:
Ask companies or organisations to contact the team through the contact page.
`;

function cleanReply(text) {
  return String(text || "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#{1,6}\s?/g, "")
    .replace(/[—–]/g, "-")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractReply(data) {
  if (data.output_text) return cleanReply(data.output_text);

  const textParts = [];

  if (Array.isArray(data.output)) {
    data.output.forEach((item) => {
      if (Array.isArray(item.content)) {
        item.content.forEach((content) => {
          if (content.text) textParts.push(content.text);
        });
      }
    });
  }

  return cleanReply(textParts.join("\n").trim() || "Sorry, I could not answer that.");
}

async function callOpenAI(model, message, history) {
  const recentHistory = history
    .slice(-6)
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
      "Accept-Encoding": "identity"
    },
    body: JSON.stringify({
      model,
      instructions: SYSTEM_PROMPT,
      input: `
Previous conversation:
${recentHistory || "None"}

User message:
${message}

Reply in no more than 55 words. Do not use markdown, asterisks or long dashes.
      `,
      max_output_tokens: 120
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI request failed");
  }

  return extractReply(data);
}

async function generateReply(message, history) {
  let lastError;

  for (const model of models) {
    try {
      const reply = await callOpenAI(model, message, history);
      return { reply, model };
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
    models,
    faqLoaded: Boolean(FAQ_KNOWLEDGE)
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
    console.error(error.message);

    res.status(500).json({
      error: "Chatbot unavailable. Please try again later."
    });
  }
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Feed Us Up chatbot running on port ${port}`);
});
