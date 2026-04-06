import OpenAI from "openai";

const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
const baseURL = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";

if (!apiKey) {
  throw new Error(
    "OPENROUTER_API_KEY (or OPENAI_API_KEY) must be set.",
  );
}

export const openai = new OpenAI({
  apiKey,
  baseURL,
});
