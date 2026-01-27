import { GoogleGenAI, Type } from "@google/genai";
import { AIPersona } from './gameManager';

const GEMINI_MODEL = 'gemini-2.0-flash';

interface AIDescriptionOutput {
  player_name: string;
  content: string;
  thought_process: string;
}

interface AIVoteOutput {
  player_name: string;
  content: string;
  vote_target: string;
  thought_process: string;
}

// Get Gemini client
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined in environment variables.");
  }
  return new GoogleGenAI({ apiKey });
};

// Fallback descriptions pool (more variety)
const FALLBACK_DESCRIPTIONS = {
  Coffee: [
    "morning fuel lol",
    "that brown drink everyone's addicted to",
    "cant function without it tbh",
    "bitter but good",
    "the thing that wakes you up",
    "hot drink, kinda bitter",
    "okay so like... its what you drink to not be dead in the morning",
    "bean water basically",
  ],
  Tea: [
    "relaxing drink i guess",
    "something warm and calming",
    "leaf water lol",
    "the chill version of... you know",
    "drink it when youre sick maybe",
    "hot drink, pretty mild",
    "british people love this thing",
    "steeping leaves in water basically",
  ],
};

// Fallback vote justifications (more variety)
const FALLBACK_VOTE_REASONS = [
  "idk something felt off",
  "gut feeling tbh",
  "their description was weird",
  "just doesnt add up to me",
  "seemed suspicious ngl",
  "hmm not sure but going with this",
  "process of elimination i guess",
  "that description was kinda sus",
];

// Build natural prompt based on persona
const buildPersonaPrompt = (aiName: string, otherPlayers: string[], persona: AIPersona, aiWord: string, isUndercover: boolean) => {
  const personality = persona.personality;
  const strategy = persona.strategy;
  const quirks = persona.quirks;

  // Build quirk instructions (probabilistic - not always applied)
  const quirkInstructions = quirks.length > 0 
    ? `\nText style notes (apply naturally, not always):\n${quirks.map(q => `- ${q}`).join('\n')}`
    : '\nText style: Normal, no special quirks.';

  // Strategic context based on role
  const roleContext = isUndercover
    ? `You have a DIFFERENT word than most players. Your goal: blend in and avoid suspicion.`
    : `You have the SAME word as most players. Your goal: find who has the different word.`;

  return `You're ${aiName} playing a word guessing game. Other players: ${otherPlayers.join(', ')}.

Your word: "${aiWord}"
${roleContext}

Your personality: ${personality.description}
Example phrases you might naturally use: ${personality.examples.join(', ')}${quirkInstructions}

Your approach this game: ${strategy.description}

IMPORTANT - Write like a real human:
- Vary your response length naturally (sometimes short, sometimes longer)
- Don't be too perfect or too weird - find a middle ground
- Real humans sometimes give boring descriptions
- Match your personality but don't overdo it
- First instinct is often most human-like
- ${strategy.name === 'normal' ? 'Keep it simple and plain.' : `Remember your ${strategy.name} strategy.`}
`;
};

// Generate AI description WITHOUT seeing other players' descriptions
export const generateAIDescription = async (
  aiWord: string,
  aiName: string,
  otherPlayerNames: string[],
  persona: AIPersona,
  isUndercover: boolean
): Promise<AIDescriptionOutput> => {
  const ai = getGeminiClient();

  const prompt = `${buildPersonaPrompt(aiName, otherPlayerNames, persona, aiWord, isUndercover)}

TASK: Describe your word "${aiWord}" in ONE sentence without saying the word itself.

Think about:
- What would a real person say off the top of their head?
- Don't overthink it - quick, natural responses are more human
- Match your personality style
- ${persona.strategy.name === 'risky' ? 'It\'s okay to be slightly creative or odd.' : 'Keep it reasonable.'}

Return JSON:
{
  "player_name": "${aiName}",
  "content": "[Your one-sentence description - natural and human-like]",
  "thought_process": "[Hidden reasoning]"
}`;

  try {
    const response = await ai.models.generateContent({
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
        },
        temperature: 0.95,  // High but not max for some consistency
        topP: 0.95,
        topK: 64,
      },
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      throw new Error("Empty response from Gemini API.");
    }
    
    const output: AIDescriptionOutput = JSON.parse(jsonStr);
    console.log(`AI (${persona.personality.name}/${persona.strategy.name}) Description: "${output.content}"`);
    return output;

  } catch (error) {
    console.error("Error calling Gemini API for description:", error);
    // Fallback - pick random description from pool
    const pool = FALLBACK_DESCRIPTIONS[aiWord as keyof typeof FALLBACK_DESCRIPTIONS] || FALLBACK_DESCRIPTIONS.Coffee;
    const randomDesc = pool[Math.floor(Math.random() * pool.length)];
    return {
      player_name: aiName,
      content: randomDesc,
      thought_process: "API call failed, using fallback description.",
    };
  }
};

// Generate AI vote based on all descriptions
export const generateAIVote = async (
  aiWord: string,
  allDescriptions: { playerName: string; description: string }[],
  aiName: string,
  persona: AIPersona,
  isUndercover: boolean
): Promise<AIVoteOutput> => {
  const ai = getGeminiClient();

  const otherPlayerNames = allDescriptions
    .filter(d => d.playerName !== aiName)
    .map(d => d.playerName);

  const descriptionsText = allDescriptions
    .map(d => `${d.playerName}: "${d.description}"`)
    .join('\n');

  const prompt = `${buildPersonaPrompt(aiName, otherPlayerNames, persona, aiWord, isUndercover)}

ALL DESCRIPTIONS:
${descriptionsText}

TASK: Vote for who you think has a DIFFERENT word than the majority.

Decision-making:
- Look for descriptions that don't quite match
- Consider: whose description seems "off" compared to the group?
- ${isUndercover ? 'You might be the odd one out - try to deflect suspicion subtly.' : 'You have the same word as most - find the outlier.'}
- ${persona.strategy.name === 'deflect' ? 'Use your deflect strategy - point suspicion elsewhere.' : `Apply your ${persona.strategy.name} approach.`}
- Don't always pick the most obvious choice - humans sometimes make surprising votes
- Your justification should be brief and natural (3-10 words typically)
- Match your personality style in your reason

RULES:
- You CANNOT vote for yourself (${aiName})
- Give a short, casual reason matching your ${persona.personality.name} personality

Return JSON:
{
  "player_name": "${aiName}",
  "content": "[Brief casual reason - 3-10 words, natural]",
  "vote_target": "[Exact name of player you're voting for]",
  "thought_process": "[Hidden strategic reasoning]"
}`;

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            player_name: { type: Type.STRING },
            content: { type: Type.STRING },
            vote_target: { type: Type.STRING },
            thought_process: { type: Type.STRING }
          },
          required: ["player_name", "content", "vote_target", "thought_process"],
        },
        temperature: 0.95,
        topP: 0.95,
        topK: 64,
      },
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      throw new Error("Empty response from Gemini API.");
    }
    
    const output: AIVoteOutput = JSON.parse(jsonStr);
    console.log(`AI (${persona.personality.name}/${persona.strategy.name}) Vote: ${output.vote_target} - "${output.content}"`);
    return output;

  } catch (error) {
    console.error("Error calling Gemini API for vote:", error);
    // Fallback - vote for a random human player with random reason
    const humanPlayers = allDescriptions.filter(d => d.playerName !== aiName);
    const randomTarget = humanPlayers[Math.floor(Math.random() * humanPlayers.length)]?.playerName || otherPlayerNames[0];
    const randomReason = FALLBACK_VOTE_REASONS[Math.floor(Math.random() * FALLBACK_VOTE_REASONS.length)];
    return {
      player_name: aiName,
      content: randomReason,
      vote_target: randomTarget,
      thought_process: "API call failed, using random vote.",
    };
  }
};
