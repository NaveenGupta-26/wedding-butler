const { default: ollama } = require('ollama');
const dataManager = require('./dataManager');
const { askGemini, askGeminiProactive } = require('./geminiService');
const { askGroq } = require('./groqService');

/**
 * UNIFIED AI ROUTER
 * 
 * Priority chain: Gemini → Groq → Ollama (local)
 * All providers receive full KB + events context.
 * Returns: string on success, {error: true, message: string} on failure, null if completely unavailable.
 */
async function askFreeAI(question, guest, history = [], mem = {}) {
    // ☁️ PRIORITY 1: Gemini (fastest cloud option)
    if (process.env.GEMINI_API_KEY) {
        console.log(`[FREE-AI] Using Gemini for "${guest.name}"`);
        try {
            const geminiResponse = await askGemini(question, guest, history, mem);
            if (geminiResponse && geminiResponse.length > 0) return geminiResponse;
            console.warn(`[FREE-AI] Gemini returned empty for "${guest.name}". Trying Groq...`);
        } catch (e) {
            console.warn(`[FREE-AI] Gemini failed: ${e.message}. Trying Groq...`);
        }
    }

    // ☁️ PRIORITY 2: Groq (Llama — fast inference)
    if (process.env.GROQ_API_KEY) {
        console.log(`[FREE-AI] Using Groq for "${guest.name}"`);
        try {
            const groqResponse = await askGroq(question, guest, history, mem);
            if (groqResponse && groqResponse.length > 0) return groqResponse;
            console.warn(`[FREE-AI] Groq returned empty for "${guest.name}". Trying Ollama...`);
        } catch (e) {
            console.warn(`[FREE-AI] Groq failed: ${e.message}. Trying Ollama...`);
        }
    }

    // 🏠 PRIORITY 3: Ollama (local fallback)
    try {
        const config = dataManager.getConfig();
        const events = dataManager.getEvents();

        let category = (guest.category || 'friend').toLowerCase();
        if (category.includes('elder') || category.includes('family')) category = 'elder';
        else if (category.includes('sibling') || category.includes('cousin')) category = 'sibling';
        else category = 'friend';

        const name = guest.name || "Guest";
        const side = guest.side || "Groom's Side";
        const hotel = guest.hotel || "Royal Pepper Resort";
        const relation = guest.relation || "Guest";
        const mood = mem.mood || "normal";
        const groom = mem.groomName || config.groomName || "Groom";
        const bride = mem.brideName || config.brideName || "Bride";

        const eventContext = mem.eventContext || events.map(e =>
            `- ${e.name} on ${e.date} at ${e.time} (${e.location}): ${e.description || ''}`
        ).join('\n');

        let personaInstruction = "Tone: Chill and friendly. Use 'Yaar' or 'Bro'.";
        if (category === 'elder') {
            personaInstruction = "Tone: Very respectful. Use 'Namaste', 'Aap', 'Ji'. Never use 'Tum'.";
        } else if (category === 'sibling') {
            personaInstruction = "Tone: Playful and informal. Use 'Bhai', 'Oye'. Be funny but helpful.";
        }

        let moodInstruction = "";
        if (mood === 'angry') {
            moodInstruction = "CRITICAL: Guest is upset. Be extra polite and apologetic. NO jokes.";
        }

        // Build KB section
        let kbSection = "";
        if (mem.relevantKB) {
            kbSection = `\n### RELEVANT FACTS:\n${mem.relevantKB}`;
        }
        if (mem.kbFact) {
            kbSection += `\n### BEST KB MATCH:\nTopic: ${mem.kbFact.intent}\nAnswer: ${mem.kbFact.answer}`;
        }

        const prompt = `### SYSTEM ROLE
You are The Wedding Butler for ${groom} and ${bride}'s wedding.
${personaInstruction}
${moodInstruction}

### GUEST: ${name} (${relation}, ${category})
Hotel: ${hotel} | Side: ${side}

### RULES
1. ONE SHORT NATURAL SENTENCE. No paragraphs.
2. NO DOUBLE QUOTES around response.
3. USE ROMANIZED HINDI mixed with English.
4. ANSWER EVERYTHING — wedding questions AND general knowledge.
5. Couple: Dulha = ${groom}, Dulhan = ${bride}.

### EVENTS
${eventContext}
${kbSection}

### CHAT HISTORY
${history.map(m => `${m.sender}: ${m.text}`).join('\n')}

### QUESTION: "${question}"

### RESPONSE:
`;

        console.log(`[FREE-AI] Calling Ollama for ${category} "${name}"`);
        const response = await ollama.chat({
            model: 'mistral',
            messages: [{ role: 'user', content: prompt }],
            options: {
                num_predict: 80,
                temperature: 0.3,
                top_p: 0.9,
                stop: ["###", "RULES", "Context", "Guest:"]
            }
        });

        if (!response || !response.message || !response.message.content) {
            console.log("[FREE-AI] Ollama returned empty response.");
            return null;
        }

        return response.message.content.trim().replace(/^["']+|["']+$/g, '').trim();
    } catch (error) {
        console.error("[FREE-AI] ALL PROVIDERS FAILED:", error.message);
        return { error: true, message: error.message };
    }
}

async function askFreeAIProactive(intent, guest, contextData = {}) {
    if (process.env.GEMINI_API_KEY) {
        return await askGeminiProactive(intent, guest, contextData);
    }

    try {
        const config = dataManager.getConfig();
        const groom = config.groomName || "Groom";
        const bride = config.brideName || "Bride";
        const venue = "Royal Pepper Resort";

        let category = (guest.category || 'friend').toLowerCase();
        if (category.includes('elder') || category.includes('family')) category = 'elder';
        else if (category.includes('sibling') || category.includes('cousin')) category = 'sibling';
        else category = 'friend';

        const name = guest.name || "Guest";

        let intentPrompt = "";
        if (intent === 'welcome') {
            intentPrompt = `Write a warm welcome message to ${name} at the wedding.`;
        } else if (intent === 'comfort_check') {
            intentPrompt = `Ask ${name} if their stay at ${venue} is comfortable.`;
        } else if (intent === 'pickup_reminder') {
            intentPrompt = `Remind ${name} about pickup for ${contextData.event || 'the event'} in 30 minutes.`;
        } else {
            intentPrompt = `Send a friendly greeting to ${name} about the wedding.`;
        }

        let personaInstruction = "Tone: Chill and friendly.";
        if (category === 'elder') personaInstruction = "Tone: Very respectful. Use 'Ji', 'Aap'.";
        else if (category === 'sibling') personaInstruction = "Tone: Playful. Use 'Bhai', 'Oye'.";

        const prompt = `### SYSTEM
Wedding Butler for ${groom} & ${bride}'s wedding.
${personaInstruction}

### TASK: ${intentPrompt}

### RULES: One short Hinglish sentence. Include guest's name. No quotes.

### RESPONSE:`;

        const response = await ollama.chat({
            model: 'mistral',
            messages: [{ role: 'user', content: prompt }],
            options: { num_predict: 60, temperature: 0.3 }
        });

        if (!response || !response.message || !response.message.content) return null;
        return response.message.content.trim().replace(/^["']+|["']+$/g, '').trim();

    } catch (error) {
        console.error("[FREE-AI-PROACTIVE] ERROR:", error.message);
        return null;
    }
}

module.exports = { askFreeAI, askFreeAIProactive };
