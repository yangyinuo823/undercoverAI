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

export interface AIDiscussionOutput {
  player_name: string;
  content: string;
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

// Fallback descriptions pool when API fails (keyed for Coffee/Tea; generic for any other word)
const FALLBACK_DESCRIPTIONS: Record<string, string[]> = {
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

const GENERIC_FALLBACK_DESCRIPTIONS = [
  "something you'd recognize if you saw it",
  "pretty common thing tbh",
  "idk how to describe it without giving it away",
  "you know what i mean",
  "kinda obvious once you think about it",
  "everyone knows this one",
  "common everyday thing",
  "think of the first thing that comes to mind",
];

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

// Turn position: 0 = first, 1-2 = middle, 3 = last
export type TurnPosition = 'first' | 'middle' | 'last';

// Generate AI description (turn-based: first = blind, middle = sees previous, last = sees previous + no-copying rule)
export const generateAIDescription = async (
  aiWord: string,
  aiName: string,
  otherPlayerNames: string[],
  persona: AIPersona,
  isUndercover: boolean,
  turnIndex: number,
  previousDescriptions: { playerName: string; description: string }[]
): Promise<AIDescriptionOutput> => {
  const ai = getGeminiClient();

  const position: TurnPosition = turnIndex === 0 ? 'first' : turnIndex === 3 ? 'last' : 'middle';
  const hasPrevious = previousDescriptions.length > 0;
  const previousText = hasPrevious
    ? previousDescriptions.map(d => `${d.playerName}: "${d.description}"`).join('\n')
    : '';

  let taskSection: string;
  if (position === 'first') {
    taskSection = `TASK: Describe your word "${aiWord}" in ONE sentence without saying the word itself.
You are going FIRST - you have not seen anyone else's description yet.
Think about: What would a real person say off the top of their head? Don't overthink it.`;
  } else if (position === 'last') {
    taskSection = `TASK: Describe your word "${aiWord}" in ONE sentence without saying the word itself.

DESCRIPTIONS SO FAR (you are going LAST - everyone else has already spoken):
${previousText}

STRICT RULES (you are last - do NOT sound like you copied):
- You MUST NOT repeat phrases, wording, or sentence structure from the descriptions above.
- Sound like a different person. Vary your sentence structure and word choice.
- Do NOT paraphrase or echo what others said. Give a description that fits your word but feels DISTINCT from what's already been said.`;
  } else {
    taskSection = `TASK: Describe your word "${aiWord}" in ONE sentence without saying the word itself.

DESCRIPTIONS SO FAR (you are in the middle - these players have already spoken):
${previousText}

You can use context to blend in, but write in your own words. Match your personality.`;
  }

  const prompt = `${buildPersonaPrompt(aiName, otherPlayerNames, persona, aiWord, isUndercover)}

${taskSection}
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
    const pool = FALLBACK_DESCRIPTIONS[aiWord] || GENERIC_FALLBACK_DESCRIPTIONS;
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

// Fallback discussion lines (short, casual)
const FALLBACK_DISCUSSION_CIVILIAN = [
  "i think someone's description was off",
  "not sure who but one felt different",
  "leaning towards voting one of them",
];
const FALLBACK_DISCUSSION_UNDERCOVER = [
  "could be any of us tbh",
  "lets just vote and see",
  "i dont have a strong read",
];

// Generate AI discussion message (civilian: detection; undercover: mislead). Returns empty content to stay silent.
export const generateAIDiscussionMessage = async (
  aiWord: string,
  aiName: string,
  otherPlayerNames: string[],
  persona: AIPersona,
  isUndercover: boolean,
  allDescriptions: { playerName: string; description: string }[],
  discussionTranscript: { playerName: string; message: string }[]
): Promise<AIDiscussionOutput> => {
  const ai = getGeminiClient();

  const personality = persona.personality;
  const quirkInstructions = persona.quirks.length > 0
    ? `\nText style notes (apply naturally):\n${persona.quirks.map(q => `- ${q}`).join('\n')}`
    : '';

  const descriptionsText = allDescriptions
    .map(d => `${d.playerName}: "${d.description}"`)
    .join('\n');
  const discussionText = discussionTranscript.length > 0
    ? discussionTranscript.map(d => `${d.playerName}: ${d.message}`).join('\n')
    : '(No messages yet.)';

  const roleInstruction = isUndercover
    ? `You have a DIFFERENT word (Undercover). Goal: blend in and mislead — create doubt, deflect suspicion, point at others, or add harmless noise. Do NOT reveal your word.`
    : `You have the SAME word as most (Civilian). Goal: share who you think has the different word and why, briefly.`;

  const taskRules = isUndercover
    ? 'Mislead: suggest someone else is suspicious, or say something vague that doesn\'t give away your word. No long speeches.'
    : 'Give your read: who seems off and why in one line. Don\'t over-explain.';

  const prompt = `You're ${aiName} in a word-guessing game. Other players: ${otherPlayerNames.join(', ')}.

Your word: "${aiWord}"
Your role: ${roleInstruction}

DESCRIPTIONS (what everyone said in order):
${descriptionsText}

DISCUSSION SO FAR (free chat before voting):
${discussionText}

Your personality: ${personality.description}
Examples: ${personality.examples.join(', ')}${quirkInstructions}

RULES:
- Write ONE short message (1–2 sentences, under 100 chars). Casual, like real chat.
- ${taskRules}
- If you would naturally stay silent (e.g. nothing to add yet), return content as empty string "".
- Match your personality; vary length. No bullet points or formal tone.

Return JSON only:
{
  "player_name": "${aiName}",
  "content": "[Your one short chat line, or \"\" if you stay silent]",
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
            thought_process: { type: Type.STRING },
          },
          required: ["player_name", "content", "thought_process"],
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

    const output: AIDiscussionOutput = JSON.parse(jsonStr);
    if (output.content && output.content.trim()) {
      console.log(`AI (${persona.personality.name}) Discussion: "${output.content}"`);
    }
    return output;
  } catch (error) {
    console.error("Error calling Gemini API for discussion:", error);
    const pool = isUndercover ? FALLBACK_DISCUSSION_UNDERCOVER : FALLBACK_DISCUSSION_CIVILIAN;
    const msg = pool[Math.floor(Math.random() * pool.length)];
    return {
      player_name: aiName,
      content: msg,
      thought_process: "API call failed, using fallback.",
    };
  }
};
