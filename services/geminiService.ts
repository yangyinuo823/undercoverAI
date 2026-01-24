import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { Player4Output, Role } from '../types';
import { CIVILIAN_WORD, UNDERCOVER_WORD, GEMINI_MODEL, PLAYER_4_BASE_PROMPT, PLAYER_4_NAME } from '../constants';

// Initialize GoogleGenAI. The API key is expected to be available via process.env.API_KEY.
const getGeminiClient = () => {
  if (!process.env.API_KEY) {
    throw new Error("API_KEY is not defined in the environment variables.");
  }
  return new GoogleGenAI({ apiKey: process.env.API_KEY });
};

export const generatePlayer4Description = async (
  player4Role: Role,
  player4Word: string,
  otherDescriptions: string[]
): Promise<Player4Output> => {
  const ai = getGeminiClient();

  const roleDescription = player4Role === Role.CIVILIAN ? 'Civilian (Word: Coffee)' : 'Undercover (Word: Tea)';

  const prompt = `
  ${PLAYER_4_BASE_PROMPT}

  Your Current Role: ${roleDescription}
  Your Secret Word: ${player4Word}

  Phase: Description Phase.
  Your Task: Provide a 1-sentence description of your word.
  Strategy:
    - If you are the Undercover, try to blend in by using vague descriptions based on what others said.
    - If you are a Civilian, give a clear but not too obvious description of your word.
    - Incorporate "human" hesitation.

  Other Player Descriptions so far:
  ${otherDescriptions.map((desc, i) => `Player_${i + 1}: "${desc}"`).join('\n')}

  Generate your 1-sentence description now, following the persona and output format.
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            player_name: { type: Type.STRING },
            content: { type: Type.STRING },
            thought_process: { type: Type.STRING }
          },
          required: ["player_name", "content", "thought_process"],
          propertyOrdering: ["player_name", "content", "thought_process"],
        },
        temperature: 0.9,
        topP: 0.95,
        topK: 64,
      },
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      throw new Error("Empty response from Gemini API.");
    }
    const player4Output: Player4Output = JSON.parse(jsonStr);
    return player4Output;

  } catch (error) {
    console.error("Error calling Gemini API for description:", error);
    // Provide a fallback response in case of API error
    return {
      player_name: PLAYER_4_NAME,
      content: player4Role === Role.CIVILIAN ? "uhh, it's like a warm drink you have in the morning" : "idk maybe like... something you steep?",
      thought_process: "API call failed, generated fallback description.",
    };
  }
};

export const generatePlayer4Vote = async (
  player4Role: Role,
  player4Word: string,
  allDescriptions: { player: string; description: string }[]
): Promise<Player4Output> => {
  const ai = getGeminiClient();

  const roleDescription = player4Role === Role.CIVILIAN ? 'Civilian (Word: Coffee)' : 'Undercover (Word: Tea)';

  const prompt = `
  ${PLAYER_4_BASE_PROMPT}

  Your Current Role: ${roleDescription}
  Your Secret Word: ${player4Word}

  Phase: Voting Phase.
  Your Task: Analyze the descriptions of Player 1, 2, and 3 (and your own). Identify who sounds like they have a different word. Provide your vote and a short "human-like" justification.
  Strategy:
    - If Civilian (Coffee): Identify the player whose description seems most off for "Coffee", or too specific for "Tea".
    - If Undercover (Tea): Identify the player whose description is either too generic (could be "Tea") or too specific for "Coffee", making them look like the odd one out if you want to deflect. Or vote for someone who truly sounds like a Civilian to maintain cover. Avoid voting for the true Civilians if you are a Civilian.
    - Use casual, human-like justification.

  All Player Descriptions:
  ${allDescriptions.map(p => `${p.player}: "${p.description}"`).join('\n')}

  Generate your vote target (Player_1, Player_2, or Player_3) and a short justification, following the persona and output format.
  `;

  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            player_name: { type: Type.STRING },
            content: { type: Type.STRING }, // This will be the justification
            vote_target: { type: Type.STRING },
            thought_process: { type: Type.STRING }
          },
          required: ["player_name", "content", "vote_target", "thought_process"],
          propertyOrdering: ["player_name", "content", "vote_target", "thought_process"],
        },
        temperature: 0.9,
        topP: 0.95,
        topK: 64,
      },
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      throw new Error("Empty response from Gemini API.");
    }
    const player4Output: Player4Output = JSON.parse(jsonStr);
    return player4Output;

  } catch (error) {
    console.error("Error calling Gemini API for vote:", error);
    // Fallback response
    const availableTargets = allDescriptions.filter(p => p.player !== PLAYER_4_NAME).map(p => p.player);
    const randomVote = availableTargets[Math.floor(Math.random() * availableTargets.length)] || 'Player_1';
    return {
      player_name: PLAYER_4_NAME,
      content: "uhh, i'm just going with a gut feeling on this one",
      vote_target: randomVote,
      thought_process: "API call failed, generated fallback vote.",
    };
  }
};