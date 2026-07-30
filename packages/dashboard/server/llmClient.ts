import { GoogleGenerativeAI } from "@google/generative-ai";
import { getSystemConfig } from "./storage.js";
import { Config } from "./config.js";

async function getApiKey(): Promise<string> {
  try {
    const config = await getSystemConfig();
    if (config.geminiApiKey) {
      return config.geminiApiKey;
    }
  } catch (error) {
    console.error("Failed to read system config for Gemini API key:", error);
  }
  return Config.GEMINI_API_KEY || "";
}

export async function generateTextWithGemini(prompt: string): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured. Please set it in System Settings or via GEMINI_API_KEY environment variable.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  // 비용 효율성과 성능의 조화를 위해 기본적으로 gemini-1.5-flash 모델을 활용합니다.
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const result = await model.generateContent(prompt);
  return result.response.text();
}
