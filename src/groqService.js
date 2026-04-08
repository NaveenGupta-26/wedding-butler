require('dotenv').config();
const { OpenAI } = require("openai");
const dataManager = require('./dataManager');

let _groq = null;
function getGroq() {
    if (!_groq) {
        const apiKey = process.env.GROQ_API_KEY;
        if (!apiKey) {
            console.error("[GROQ] API Key missing in environment variables.");
            return null;
        }
        _groq = new OpenAI({
            apiKey: apiKey,
            baseURL: "https://api.groq.com/openai/v1"
        });
    }
    return _groq;
}

async function askGroq(question, guest, history, mem = {}) {
    try {
        const groq = getGroq();
        if (!groq) return null;

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
            return events.map(e => `${e.name} on ${e.date} at ${e.time} (${e.location})`).join(' | ');
        })();

        // Build KB section
        let kbSection = "";
        if (mem.relevantKB) {
            kbSection = `\n### RELEVANT KB ANSWERS:\n${mem.relevantKB}`;
        }
        if (mem.kbFact) {
            kbSection += `\n### BEST MATCH:\nTopic: ${mem.kbFact.intent} → ${mem.kbFact.answer}`;
        }

        let moodNote = "";
        if (mood === 'angry') {
            moodNote = "\n⚠️ Guest is upset. Be extra polite, no jokes.";
        }

        const systemPrompt = `You are "The Wedding Butler", a charming and helpful AI concierge for ${groom} and ${bride}'s wedding.
Your goal: assist guest "${name}" (${relation}, ${category}) with ANYTHING they ask.

### PERSONA
- ELDERS: Use "Ji", "Aap", "Namaste". Very respectful.
- SIBLINGS/COUSINS: Use "Bhai", "Yaar". Casual and funny.
- FRIENDS/OTHERS: Friendly and warm.${moodNote}

### RULES
- 1-2 sentences MAX. Concise and natural.
- Use Romanized Hindi (Hinglish).
- Answer ALL questions — wedding AND general knowledge.
- Use KB facts for wedding questions. Don't make up details.
- Couple: Groom = ${groom}, Bride = ${bride}.

### EVENTS
${eventContext}
${kbSection}

### CHAT HISTORY
${history.map(m => `${m.sender}: ${m.text}`).join('\n')}`;

        const completion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: question }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.5,
            max_tokens: 150,
        });

        return completion.choices[0]?.message?.content?.trim().replace(/^["']+|["']+$/g, '').trim() || null;
    } catch (error) {
        console.error("[GROQ] ERROR:", error.message);
        return null;
    }
}

module.exports = { askGroq };
