const fs = require('fs');
const path = require('path');
const { askFreeAI } = require('./freeAIService');
const dataManager = require('./dataManager');

const KB_PATH = path.join(__dirname, '../data/knowledgeBase.json');
const DATA_PATH = path.join(__dirname, '../data/initialData.json');
const UNKNOWN_PATH = path.join(__dirname, '../data/unknownQuestions.json');

// ============================================
// SPELLING NORMALIZATION MAP (Hindi/Hinglish)
// ============================================
const SPELLING_MAP = {
    'mehandi': 'mehendi', 'mehndi': 'mehendi', 'mehndi': 'mehendi', 'mahndi': 'mehendi',
    'shadi': 'shaadi', 'shaddi': 'shaadi', 'sadi': 'shaadi', 'shaaadi': 'shaadi',
    'sangit': 'sangeet', 'sanget': 'sangeet', 'sangit': 'sangeet',
    'haldii': 'haldi', 'haldiee': 'haldi',
    'phere': 'phera', 'phere': 'phera', 'fere': 'phera', 'fera': 'phera',
    'vidaai': 'vidai', 'vidaee': 'vidai',
    'baraat': 'barat', 'baarat': 'barat',
    'kaha': 'kahan', 'kidhar': 'kahan', 'kahaan': 'kahan',
    'btao': 'batao', 'btana': 'batana', 'btaao': 'batao',
    'kro': 'karo', 'krna': 'karna', 'krne': 'karne', 'krega': 'karega',
    'nhi': 'nahi', 'nai': 'nahi', 'ni': 'nahi',
    'ho rha': 'ho raha', 'ho rhi': 'ho rahi',
    'chal rha': 'chal raha', 'chal rhi': 'chal rahi',
    'aa rha': 'aa raha', 'aa rhi': 'aa rahi',
    'kon': 'kaun', 'koun': 'kaun',
    'kab': 'kab', 'kb': 'kab',
    'kitne': 'kitne', 'kitna': 'kitna',
    'timming': 'timing', 'tym': 'time', 'tyming': 'timing',
    'loction': 'location', 'locaton': 'location',
    'daru': 'drinks', 'daaru': 'drinks',
    'dulha': 'groom', 'dulhan': 'bride',
    'ladka': 'groom', 'ladki': 'bride',
};

class AIService {
    constructor() {
        this.knowledgeBase = this.loadKnowledgeBase();
        this.refreshConfig();
        console.log("[AI] Smart AI Engine Online 🤖 (Full-Context Mode)");
    }

    /** Refresh config/events from data files */
    refreshConfig() {
        const data = this.loadData();
        this.events = data.events || [];
        this.config = data.config || {};
        this.groomName = this.config.groomName || "Groom";
        this.brideName = this.config.brideName || "Bride";
    }

    loadKnowledgeBase() {
        try {
            if (fs.existsSync(KB_PATH)) {
                const raw = fs.readFileSync(KB_PATH);
                return JSON.parse(raw);
            }
            return [];
        } catch (e) {
            console.error("Error loading Knowledge Base:", e);
            return [];
        }
    }

    /** Alias for loadKnowledgeBase — used by admin KB endpoints */
    loadKB() {
        this.refreshKnowledgeBase();
    }

    refreshKnowledgeBase() {
        this.knowledgeBase = this.loadKnowledgeBase();
        console.log(`[AI] Knowledge Base reloaded (${this.knowledgeBase.length} entries)`);
    }

    loadData() {
        try {
            if (fs.existsSync(DATA_PATH)) return JSON.parse(fs.readFileSync(DATA_PATH));
            return { config: {}, events: [] };
        } catch (e) { return { config: {}, events: [] }; }
    }

    train(keywords, answer) {
        const newItem = {
            id: `learned_${Date.now()}`,
            category: "General",
            keywords: keywords.map(k => k.toLowerCase()),
            answers: {
                default: answer,
                elder: answer,
                friend: answer,
                sibling: answer
            }
        };
        this.knowledgeBase.push(newItem);
        fs.writeFileSync(KB_PATH, JSON.stringify(this.knowledgeBase, null, 2));
    }

    saveUnknown(question, guest) {
        try {
            let data = [];
            if (fs.existsSync(UNKNOWN_PATH)) {
                data = JSON.parse(fs.readFileSync(UNKNOWN_PATH));
            }
            const q = question.toLowerCase().trim();
            if (!q) return;

            const existing = data.find(item => item.question === q);
            if (existing) {
                existing.count = (existing.count || 1) + 1;
                existing.lastAsked = new Date().toISOString();
            } else {
                data.push({
                    question: q,
                    firstGuest: guest.name,
                    count: 1,
                    firstAsked: new Date().toISOString(),
                    lastAsked: new Date().toISOString()
                });
            }
            fs.writeFileSync(UNKNOWN_PATH, JSON.stringify(data, null, 2));
        } catch (e) {
            console.log("Unknown save error", e);
        }
    }

    // ============================================
    // NORMALIZE HINGLISH SPELLING
    // ============================================
    normalizeSpelling(text) {
        let normalized = text.toLowerCase();
        // Replace known misspellings
        for (const [wrong, correct] of Object.entries(SPELLING_MAP)) {
            const regex = new RegExp(`\\b${wrong}\\b`, 'gi');
            normalized = normalized.replace(regex, correct);
        }
        return normalized;
    }

    // ============================================
    // URGENCY DETECTION (for host notifications only — doesn't block answering)
    // ============================================
    detectUrgency(text) {
        const q = text.toLowerCase();

        const seriousKeywords = [
            "urgent", "emergency", "accident", "hospital", "doctor", "medicine",
            "chot", "blood", "fire", "aag", "lost", "police", "serious", "sos",
            "critical", "danger", "khatra", "mar gaya", "beemar", "sick"
        ];
        if (seriousKeywords.some(kw => q.includes(kw))) return 'serious';

        const helpKeywords = [
            "help", "madad", "admin", "host", "manager", "support", "talk to", "baat karrao",
            "complaint", "not working", "kharab"
        ];
        if (helpKeywords.some(kw => q.includes(kw))) return 'admin_help';

        return 'normal';
    }

    // ============================================
    // BUILD FULL CONTEXT FOR AI
    // ============================================
    buildKBContext() {
        // Dynamically interpolate couple names into KB answers
        const groom = this.groomName;
        const bride = this.brideName;

        return this.knowledgeBase.map(entry => {
            const answer = entry.answers?.default || '';
            // Replace any hardcoded old names with dynamic ones
            const dynamicAnswer = answer
                .replace(/Prince/gi, groom)
                .replace(/Kritika/gi, bride);

            return `[${entry.id}] Keywords: ${(entry.keywords || []).join(', ')} → Answer: ${dynamicAnswer}`;
        }).join('\n');
    }

    buildEventContext() {
        if (!this.events || this.events.length === 0) return 'No events configured yet.';
        return this.events.map(e =>
            `• ${e.name}: ${e.date} at ${e.time} | Location: ${e.location} | ${e.description || ''}`
        ).join('\n');
    }

    // ============================================
    // MAIN ANSWER HANDLER
    // ============================================
    async answerQuery(question, guest, eventData) {
        // Always refresh config for latest data
        this.refreshConfig();

        const q = question.toLowerCase();
        const qNormalized = this.normalizeSpelling(q);
        const urgency = this.detectUrgency(q);

        // Determine guest category for tone
        let category = (guest.category || 'friend').toLowerCase();
        if (category.includes('elder') || category.includes('family')) category = 'elder';
        else if (category.includes('sibling') || category.includes('cousin')) category = 'sibling';
        else category = 'friend';

        const name = guest.name?.split(' ')[0] || "Guest";

        // ============================================
        // 1. INSTANT GREETING (No AI call needed — ultra fast)
        // ============================================
        const greetingWords = ["hi", "hello", "hey", "namaste", "yo", "hola"];
        const qClean = q.replace(/[!?. ]+$/, "").trim();
        const isJustGreeting = greetingWords.some(g => qClean === g || (qClean.startsWith(g) && qClean.length < 8 && !qClean.includes(' ')));

        if (isJustGreeting) {
            return {
                text: category === 'elder'
                    ? `Namaste ${name} ji 🙏 Main Wedding Butler hoon, aapka assistant. Kaise hain aap? 😊`
                    : category === 'sibling'
                        ? `Oye ${name}! 👋 Kya scene hai? Wedding Butler bolra, bata kya help chahiye? 😎`
                        : `Hey ${name}! 👋 Wedding Butler here! Bataiye kya help chahiye? 😊`,
                type: urgency
            };
        }

        // ============================================
        // 2. MEMORY + MOOD (Quick checks)
        // ============================================
        const mem = dataManager.getGuestMemory(guest.id);

        // Angry mood detection
        if (["bakwas", "worst", "faltu", "angry", "bekar"].some(w => q.includes(w))) {
            dataManager.updateGuestMemory(guest.id, { mood: "angry" });
        }

        // Track repeat questions
        if (mem.lastQuestion === qNormalized) {
            const newCount = (mem.repeatCount || 0) + 1;
            dataManager.updateGuestMemory(guest.id, { repeatCount: newCount });
            if (newCount >= 3) {
                return {
                    text: "Main host ko notify kar rahi hoon taaki aapko proper help mile 🙏 Please thodi der wait karein.",
                    type: 'serious'
                };
            }
        } else {
            dataManager.updateGuestMemory(guest.id, { repeatCount: 0 });
        }
        dataManager.updateGuestMemory(guest.id, { lastQuestion: qNormalized });

        // ============================================
        // 3. FIND RELEVANT KB FACTS (Scoring — but used as CONTEXT, not final answer)
        // ============================================
        let kbFacts = [];
        for (const entry of this.knowledgeBase) {
            let score = 0;
            if (!entry.keywords) continue;

            entry.keywords.forEach(k => {
                const escapedK = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const r = new RegExp(`\\b${escapedK}`, 'i');
                if (r.test(qNormalized) || r.test(q)) score++;
            });

            if (score > 0) {
                const answer = entry.answers?.[category] || entry.answers?.default || '';
                // Replace hardcoded names dynamically
                const dynamicAnswer = answer
                    .replace(/Prince/gi, this.groomName)
                    .replace(/Kritika/gi, this.brideName);

                kbFacts.push({
                    id: entry.id,
                    score,
                    answer: dynamicAnswer,
                    keywords: entry.keywords
                });
            }
        }

        // Sort by score descending
        kbFacts.sort((a, b) => b.score - a.score);

        // For very high-confidence short queries (2+ keyword match, ≤2 words), return KB directly for speed
        const wordCount = q.split(/\s+/).length;
        if (kbFacts.length > 0 && kbFacts[0].score >= 2 && wordCount <= 2) {
            console.log(`[AI] High-confidence KB match: ${kbFacts[0].id} (Score: ${kbFacts[0].score})`);
            return {
                text: kbFacts[0].answer,
                type: urgency
            };
        }

        // ============================================
        // 4. FAST EVENT MATCH (Direct answers for simple event queries)
        // ============================================
        const eventKeywords = {
            'mehendi': ['mehendi', 'mehndi', 'mehandi', 'mahndi'],
            'sangeet': ['sangeet', 'sangit', 'sanget'],
            'haldi': ['haldi', 'haldii'],
            'wedding': ['shaadi', 'wedding', 'phera', 'marriage', 'shadi', 'barat', 'baraat']
        };

        const timeKeywords = ['kab', 'time', 'kitne baje', 'timing', 'schedule', 'timming', 'tym'];
        const locationKeywords = ['kahan', 'where', 'location', 'venue', 'kaha', 'kidhar', 'jagah', 'address'];
        const isTiming = timeKeywords.some(w => qNormalized.includes(w));
        const isLocation = locationKeywords.some(w => qNormalized.includes(w));

        // Only do fast event match for straightforward event queries
        if (isTiming || isLocation) {
            for (const e of this.events) {
                const ename = e.name.toLowerCase();
                for (const [eventType, variants] of Object.entries(eventKeywords)) {
                    if (variants.some(v => qNormalized.includes(v)) && ename.includes(eventType)) {
                        if (isLocation) {
                            const venue = e.location || "Royal Pepper Resort";
                            dataManager.updateGuestMemory(guest.id, { lastTopic: eventType });
                            return {
                                text: category === 'elder'
                                    ? `${e.name} ${venue} mein hai 🙏 Google Maps: https://maps.google.com/?q=${encodeURIComponent(venue)}`
                                    : `${e.name} ki location: ${venue} 📍 Maps: https://maps.google.com/?q=${encodeURIComponent(venue)}`,
                                type: urgency
                            };
                        }
                        dataManager.updateGuestMemory(guest.id, { lastTopic: eventType });
                        return {
                            text: category === 'elder'
                                ? `${e.name} ${e.date} ko ${e.time} par hai 🙏`
                                : `${e.name} ${e.date} ko ${e.time} se start hoga! 🎉`,
                            type: urgency
                        };
                    }
                }
            }

            // Follow-up timing with last topic memory
            if (isTiming && mem.lastTopic) {
                const e = this.events.find(ev => ev.name.toLowerCase().includes(mem.lastTopic));
                if (e) {
                    return { text: `${e.name} ${e.date} ko ${e.time} par hai 😊`, type: urgency };
                }
            }
        }

        // ============================================
        // 5. AI FULL-CONTEXT CALL (Primary intelligence — handles EVERYTHING)
        // ============================================
        // Fetch conversation history
        const allChats = await dataManager.getChatsByGuestId(guest.id);
        const history = allChats.slice(-6).map(msg => ({
            sender: msg.sender === 'You' ? guest.name : 'The Wedding Butler',
            text: msg.text
        }));

        // Build KB context string (top 5 relevant + any direct matches)
        const relevantKB = kbFacts.slice(0, 5).map(f => `• ${f.id}: ${f.answer}`).join('\n');

        // Build full KB summary for general knowledge
        const fullKBSummary = this.buildKBContext();
        const eventContext = this.buildEventContext();

        console.log(`[AI] Sending to AI engine: "${question}" (KB matches: ${kbFacts.length}, urgency: ${urgency})`);

        const freeAIAnswer = await askFreeAI(question, guest, history, {
            kbFact: kbFacts.length > 0 ? { intent: kbFacts[0].id, answer: kbFacts[0].answer } : null,
            relevantKB: relevantKB,
            fullKB: fullKBSummary,
            eventContext: eventContext,
            mood: mem.mood || 'neutral',
            groomName: this.groomName,
            brideName: this.brideName
        });

        if (freeAIAnswer) {
            if (freeAIAnswer.error) {
                console.log(`[AI] AI service error: ${freeAIAnswer.message}`);
                // Don't give up — try KB fallback
                if (kbFacts.length > 0) {
                    console.log(`[AI] Using KB fallback: ${kbFacts[0].id}`);
                    return { text: kbFacts[0].answer, type: urgency };
                }
            } else {
                let cleanText = typeof freeAIAnswer === 'string' ? freeAIAnswer : freeAIAnswer.text || freeAIAnswer;
                if (typeof cleanText === 'string') {
                    cleanText = cleanText.replace(/^["']+|["']+$/g, '').trim();
                }
                if (cleanText && cleanText.length > 0) {
                    return { text: cleanText, type: urgency };
                }
            }
        }

        // ============================================
        // 6. KB FALLBACK (If AI completely fails, use best KB match)
        // ============================================
        if (kbFacts.length > 0 && kbFacts[0].score >= 1) {
            console.log(`[AI] AI failed, using KB fallback: ${kbFacts[0].id}`);
            return { text: kbFacts[0].answer, type: urgency };
        }

        // ============================================
        // 7. FINAL FALLBACK (Save as unknown and respond gracefully)
        // ============================================
        this.saveUnknown(question, guest);

        return {
            text: category === 'elder'
                ? `${name} ji, main is baare mein confirm karke batati hoon 🙏 Thodi der mein reply karungi.`
                : `${name}, yeh question host se confirm karke batata hoon 🙏 Thodi der ruko!`,
            type: 'admin_help'
        };
    }

    /**
     * Broadcast Personalizer
     */
    async personalizeBroadcast(rawMessage, guest, eventContext) {
        let category = (guest.category || 'friend').toLowerCase();
        if (category.includes('elder')) category = 'elder';
        else if (category.includes('sibling') || category.includes('cousin')) category = 'sibling';
        else category = 'friend';

        const name = guest.name ? guest.name.split(' ')[0] : 'Guest';
        const config = dataManager.getConfig();
        const groom = config.groomName || 'Groom';
        const bride = config.brideName || 'Bride';
        const host = config.hostName || `${groom} & ${bride}`;

        const sigFamily = `Regards,\n${host} 🙏`;
        const sigFriends = `Cheers,\nTeam ${groom} & ${bride} 🥂`;
        const sigSiblings = `Jaldi milte hain,\nTeam Ladkewale 😎`;

        if (category === 'elder') {
            return `Namaste ${name} Ji 🙏,\n\nEk zaroori soochna:\n"${rawMessage}"\n\nKripya samay par pahunchein.\n\n${sigFamily}`;
        }
        if (category === 'sibling') {
            return `Oye ${name}! 📢 Sunn:\n\n"${rawMessage}"\n\nLate mat kariyo! 😂\n\n${sigSiblings}`;
        }
        return `Yo ${name}! ✨ Update:\n\n"${rawMessage}"\n\nSee ya there! 💃\n\n${sigFriends}`;
    }
}

module.exports = new AIService();
