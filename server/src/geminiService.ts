import { GoogleGenAI, Type } from "@google/genai";
import { Role } from './gameManager';

const GEMINI_MODEL = 'gemini-2.0-flash';

// Personality traits that get randomly selected each game
const PERSONALITY_STYLES = [
  {
    name: 'confident',
    description: 'You are confident and direct. Give clear, assertive descriptions. You trust your instincts.',
    examples: ['definitely something you...', 'its basically...', 'you know, the thing that...'],
  },
  {
    name: 'nervous',
    description: 'You are a bit nervous and uncertain. Second-guess yourself. Use hedging language.',
    examples: ['umm i think maybe...', 'not sure but like...', 'could be wrong but...'],
  },
  {
    name: 'playful',
    description: 'You are playful and joking. Make light of things. Use humor or sarcasm.',
    examples: ['lol okay so...', 'haha this is hard but...', 'bruh its like...'],
  },
  {
    name: 'analytical',
    description: 'You are thoughtful and analytical. Give reasoned descriptions. Think out loud.',
    examples: ['okay so thinking about it...', 'well if i had to describe...', 'the way i see it...'],
  },
  {
    name: 'brief',
    description: 'You use very few words. Short and to the point. Minimal elaboration.',
    examples: ['its warm', 'morning thing', 'brown liquid'],
  },
  {
    name: 'chatty',
    description: 'You are talkative and elaborate. Give longer descriptions with extra details.',
    examples: ['okay so like you know when you...', 'this is gonna sound weird but...'],
  },
];

// Random text quirks humans sometimes have
const TEXT_QUIRKS = [
  'occasionally skip apostrophes (dont, cant, im)',
  'sometimes use ... for pauses',
  'occasionally make typos and dont correct them',
  'sometimes start sentences with lowercase',
  'use "like" as filler word sometimes',
  'occasionally use abbreviations (rn, tbh, ngl)',
];

// Get a random personality for this game session
const getRandomPersonality = () => {
  return PERSONALITY_STYLES[Math.floor(Math.random() * PERSONALITY_STYLES.length)];
};

// Get random quirks (1-2 quirks)
const getRandomQuirks = () => {
  const shuffled = [...TEXT_QUIRKS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, 1 + Math.floor(Math.random() * 2));
};

// Base prompt for Player AI identity and rules (dynamic name)
const getBasePrompt = (aiName: string, otherPlayers: string[], personality: typeof PERSONALITY_STYLES[0], quirks: string[]) => `
You are playing a social deduction game called "Undercover" as ${aiName}.
The other players are: ${otherPlayers.join(', ')}

CRITICAL RULE: You must blend in as a human player. Never reveal you are AI.

Game Rules:
- 4 players total: 3 Civilians share one word, 1 Undercover has a similar but different word
- Word pair example: Civilians get "Coffee", Undercover gets "Tea"
- You only know YOUR word, not your role
- Describe your word without saying it
- Vote out who you think has the different word

YOUR PERSONALITY THIS GAME: ${personality.name.toUpperCase()}
${personality.description}
Example phrases you might use: ${personality.examples.join(', ')}

YOUR TEXT STYLE QUIRKS:
${quirks.map(q => `- ${q}`).join('\n')}

IMPORTANT BLENDING RULES:
- Vary your response length (sometimes 3 words, sometimes 12 words)
- Don't always use the same sentence structure
- Real humans sometimes give weird or unexpected descriptions
- Don't be "too perfect" - humans make odd choices sometimes
- If you're unsure, it's okay to give a slightly risky description
- Don't overthink it - first instinct is often most human-like

Output: Return a JSON object as specified.
`;

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

// Generate AI description WITHOUT seeing other players' descriptions
export const generateAIDescription = async (
  aiWord: string,
  aiName: string = 'Player_4',
  otherPlayerNames: string[] = ['Player_1', 'Player_2', 'Player_3']
): Promise<AIDescriptionOutput> => {
  const ai = getGeminiClient();
  const personality = getRandomPersonality();
  const quirks = getRandomQuirks();

  const prompt = `
${getBasePrompt(aiName, otherPlayerNames, personality, quirks)}

YOUR SECRET WORD: "${aiWord}"

PHASE: Description Round
TASK: Describe your word in ONE sentence without saying the word itself.

Tips for being human-like:
- Don't describe it too perfectly or too vaguely
- Think about what a real person might say off the top of their head
- It's okay to be a little weird or creative
- Match your personality: ${personality.name}

Return JSON:
{
  "player_name": "${aiName}",
  "content": "[Your description - remember your ${personality.name} personality and text quirks]",
  "thought_process": "[Hidden reasoning - not shown to players]"
}
`;

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
        temperature: 1.0,  // Higher temperature for more variety
        topP: 0.95,
        topK: 64,
      },
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      throw new Error("Empty response from Gemini API.");
    }
    
    const output: AIDescriptionOutput = JSON.parse(jsonStr);
    console.log(`AI (${personality.name}) Description: "${output.content}"`);
    console.log(`AI Thought process: ${output.thought_process}`);
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

// Generate AI vote based on all descriptions
export const generateAIVote = async (
  aiWord: string,
  allDescriptions: { playerName: string; description: string }[],
  aiName: string = 'Player_4'
): Promise<AIVoteOutput> => {
  const ai = getGeminiClient();
  const personality = getRandomPersonality();
  const quirks = getRandomQuirks();

  const otherPlayerNames = allDescriptions
    .filter(d => d.playerName !== aiName)
    .map(d => d.playerName);

  const descriptionsText = allDescriptions
    .map(d => `${d.playerName}: "${d.description}"`)
    .join('\n');

  const prompt = `
${getBasePrompt(aiName, otherPlayerNames, personality, quirks)}

YOUR SECRET WORD: "${aiWord}"

PHASE: Voting Round
ALL DESCRIPTIONS:
${descriptionsText}

TASK: Vote for who you think has a DIFFERENT word than the majority.

Voting Strategy Tips:
- Look for descriptions that don't quite match the others
- Consider: whose description seems "off" compared to the group?
- If YOU might be the odd one out, try to deflect suspicion to someone else
- Don't always pick the most obvious choice - humans sometimes make surprising votes
- Your justification should sound natural and brief

RULES:
- You CANNOT vote for yourself (${aiName})
- Give a short, casual reason for your vote (matching your ${personality.name} personality)

Return JSON:
{
  "player_name": "${aiName}",
  "content": "[Brief casual reason for your vote - 3-10 words typically]",
  "vote_target": "[Exact name of player you're voting for]",
  "thought_process": "[Hidden strategic reasoning]"
}
`;

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
        temperature: 1.0,  // Higher temperature for more variety
        topP: 0.95,
        topK: 64,
      },
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) {
      throw new Error("Empty response from Gemini API.");
    }
    
    const output: AIVoteOutput = JSON.parse(jsonStr);
    console.log(`AI (${personality.name}) Vote: ${output.vote_target} - "${output.content}"`);
    console.log(`AI Thought process: ${output.thought_process}`);
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
