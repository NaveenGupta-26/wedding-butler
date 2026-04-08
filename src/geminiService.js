const { GoogleGenerativeAI } = require("@google/generative-ai");
const dataManager = require('./dataManager');

// Singleton Gemini client — created once, reused for all requests
let _genAI = null;
function getGenAI() {
    if (!_genAI) {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("[GEMINI] API Key missing in environment variables.");
            return null;
        }
        _genAI = new GoogleGenerativeAI(apiKey);
    }
    return _genAI;
}

/**
 * Retry wrapper with exponential backoff for Gemini API calls.
 */
async function withRetry(fn, maxRetries = 1) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            const status = error?.status || error?.httpStatusCode;
            const isRetryable = (status === 429 || status === 500 || status === 503 ||
                error.message?.includes('429') || error.message?.includes('RATE_LIMIT'));

            if (isRetryable && attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 1000;
                console.warn(`[GEMINI] Rate limited. Retrying in ${delay}ms... (attempt ${attempt + 1})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                throw error;
            }
        }
    }
    throw lastError;
}

/**
 * MAIN AI HANDLER — Full-context mode
 * 
 * Receives the guest question + full KB + events + history as context.
 * Gemini serves as the brain that understands the query and generates responses.
 */
async function askGemini(question, guest, history, mem = {}) {
    try {
        const genAI = getGenAI();
        if (!genAI) return null;

        const config = dataManager.getConfig();
        const groom = mem.groomName || config.groomName || "Groom";
        const bride = mem.brideName || config.brideName || "Bride";
        const venue = "Royal Pepper Resort";

        let category = (guest.category || 'friend').toLowerCase();
        if (category.includes('elder') || category.includes('family')) category = 'elder';
        else if (category.includes('sibling') || category.includes('cousin')) category = 'sibling';
        else category = 'friend';

        const name = guest.name || "Guest";
        const relation = guest.relation || "Guest";
        const hotel = guest.hotel || venue;
        const mood = mem.mood || "neutral";

        // Build Event Context
        const eventContext = mem.eventContext || (() => {
            const events = dataManager.getEvents();
            return events.map(e => `${e.name} on ${e.date} at ${e.time} (${e.location}): ${e.description || ''}`).join('\n');
        })();

        // Persona instruction
        let personaInstruction = "Tone: Be friendly, warm, and helpful. Use 'Tum' or 'Yaar'.";
        if (category === 'elder') {
            personaInstruction = "Tone: Extremely respectful. Use 'Ji', 'Aap', 'Namaste'. Never use 'Tum' or 'Tu'. Address with 'Ji' suffix.";
        } else if (category === 'sibling') {
            personaInstruction = "Tone: Super casual, playful. Use 'Bhai', 'Yaar', 'Oye'. Be funny but helpful.";
        }

        // Mood instruction
        let moodInstruction = "";
        if (mood === 'angry') {
            moodInstruction = "\n⚠️ CRITICAL: Guest is ANGRY/UPSET. Be extra polite and apologetic. NO jokes. Show you take their concern seriously.";
        }

        // Build KB section — include relevant matches prominently + include all as reference
        let kbSection = "";
        if (mem.relevantKB && mem.relevantKB.length > 0) {
            kbSection = `\n### DIRECTLY RELEVANT ANSWERS (High Priority — use these if they match the question):\n${mem.relevantKB}`;
        }
        if (mem.fullKB) {
            kbSection += `\n\n### COMPLETE WEDDING KNOWLEDGE BASE (Reference for any question):\n${mem.fullKB}`;
        }

        const systemPrompt = `You are "The Wedding Butler", a charming, witty, and extremely helpful AI concierge for the wedding of ${groom} and ${bride}.
Your job is to assist wedding guest "${name}" (${relation}, ${category}) with ANYTHING they ask.

### YOUR PERSONA
${personaInstruction}${moodInstruction}

### CRITICAL RULES
1. **BE CONCISE**: 1-2 sentences MAX. No paragraphs. Short, natural, conversational.
2. **ROMANIZED HINDI (Hinglish)**: Mix Hindi + English naturally. Write Hindi in Roman letters, NOT Devanagari.
3. **ANSWER EVERYTHING**: Whether it's about the wedding, general knowledge, jokes, weather, or random fun — ANSWER IT. You are a smart butler, not just a wedding-info bot.
4. **USE KB FACTS**: If the knowledge base has a relevant answer, USE IT as your primary source of truth for wedding-specific questions.
5. **STAY IN CHARACTER**: You are a butler persona. Use "Main" for "I". Be warm and human.
6. **NO QUOTES**: Do NOT wrap response in " " or ' '. Just the message text.
7. **COUPLE GUARD**: Dulha/Groom = ${groom}, Dulhan/Bride = ${bride}. 
8. **DO NOT HALLUCINATE**: If you don't know something wedding-specific that's not in the KB or events, say "Host se confirm karke batata hoon" — don't make up details.
9. **PERSONALIZE**: Always use the guest's first name naturally.
10. **NO DUPLICATE INFO**: Don't repeat what was already said in recent chat history.

### WEDDING EVENTS
${eventContext}

### GUEST PROFILE
Name: ${name} | Relation: ${relation} | Category: ${category} | Hotel: ${hotel} | VIP: ${guest.isVIP ? "Yes" : "No"}
${kbSection}

### CHAT HISTORY (Most Recent Last)
${history.length > 0 ? history.map(m => `${m.sender}: ${m.text}`).join('\n') : '(New conversation)'}`;

        const startTime = Date.now();

        const text = await withRetry(async () => {
            const model = genAI.getGenerativeModel({
                model: "gemini-2.0-flash",
                systemInstruction: systemPrompt,
                generationConfig: {
                    maxOutputTokens: 150,
                    temperature: 0.7,
                    topP: 0.9,
                }
            });
            const result = await model.generateContent(question);
            const response = await result.response;
            return response.text().trim();
        });

        const elapsed = Date.now() - startTime;
        console.log(`[GEMINI] Response in ${elapsed}ms for "${name}"`);

        // Cleanup
        return text.replace(/^["']+|["']+$/g, '').trim();
    } catch (error) {
        console.error("[GEMINI] ERROR:", error.message);
        return null;
    }
}

/**
 * PROACTIVE MESSAGE GENERATOR
 */
async function askGeminiProactive(intent, guest, contextData = {}) {
    try {
        const genAI = getGenAI();
        if (!genAI) return null;

        const config = dataManager.getConfig();
        const groom = config.groomName || "Groom";
        const bride = config.brideName || "Bride";
        const venue = "Royal Pepper Resort";

        let category = (guest.category || 'friend').toLowerCase();
        if (category.includes('elder') || category.includes('family')) category = 'elder';
        else if (category.includes('sibling') || category.includes('cousin')) category = 'sibling';
        else category = 'friend';

        const name = guest.name || "Guest";
        const relation = guest.relation || "Guest";

        let intentPrompt = "";
        if (intent === 'welcome') {
            intentPrompt = `Write a warm welcome message to ${name}. They have just arrived at the wedding.`;
        } else if (intent === 'comfort_check') {
            intentPrompt = `Ask ${name} if their stay at ${venue} is comfortable and if they need anything.`;
        } else if (intent === 'pickup_reminder') {
            intentPrompt = `Remind ${name} that the pickup for ${contextData.event || 'the event'} is in 30 minutes. Venue: ${contextData.venue || venue}.`;
        } else if (intent === 'event_start') {
            intentPrompt = `Tell ${name} that ${contextData.event || 'the event'} is starting now at ${contextData.venue || venue}.`;
        } else if (intent === 'fun_engagement') {
            intentPrompt = `Send a fun, hype message to ${name} about the celebrations.`;
        } else if (intent === 'blessing_request') {
            intentPrompt = `Respectfully ask ${name} for their blessings for ${groom} and ${bride}.`;
        } else {
            intentPrompt = `Send a friendly greeting to ${name} about the wedding celebrations.`;
        }

        let personaInstruction = "";
        if (category === 'elder') {
            personaInstruction = "Tone: Very respectful. Use 'Namaste', 'Aap', 'Ji'.";
        } else if (category === 'sibling') {
            personaInstruction = "Tone: Playful. Use 'Bhai', 'Oye', 'Dost'.";
        } else {
            personaInstruction = "Tone: Chill and friendly. Use 'Yaar' or 'Bro'.";
        }

        const systemPrompt = `You are The Wedding Butler for ${groom} and ${bride}'s wedding at ${venue}.
${personaInstruction}

### TASK
${intentPrompt}

### RULES
1. ONE SHORT, NATURAL SENTENCE ONLY.
2. NO DOUBLE QUOTES.
3. USE ROMANIZED HINDI (Hinglish).
4. Include guest's name naturally.`;

        const text = await withRetry(async () => {
            const model = genAI.getGenerativeModel({
                model: "gemini-2.0-flash",
                systemInstruction: systemPrompt,
                generationConfig: {
                    maxOutputTokens: 80,
                    temperature: 0.7,
                }
            });
            const result = await model.generateContent("Generate the message now.");
            const response = await result.response;
            return response.text().trim();
        });

        return text.replace(/^["']+|["']+$/g, '').trim();

    } catch (error) {
        console.error("[GEMINI-PROACTIVE] ERROR:", error.message);
        return null;
    }
}

module.exports = { askGemini, askGeminiProactive };
