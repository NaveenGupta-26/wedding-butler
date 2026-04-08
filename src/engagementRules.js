const rules = {
    Elder: {
        intents: ["welcome_personal", "comfort_check", "blessing_request"],
        cooldowns: {
            comfort_check: 12,
            blessing_request: 24,
            welcome_personal: 48
        }
    },
    Friend: {
        intents: ["fun_engagement", "event_hype", "photo_prompt"],
        cooldowns: {
            fun_engagement: 8,
            event_hype: 4,
            photo_prompt: 12
        }
    },
    Family: {
        intents: ["logistics_update", "event_reminder", "emotional_connect"],
        cooldowns: {
            logistics_update: 2,
            event_reminder: 2,
            emotional_connect: 12
        }
    },
    Default: {
        intents: ["event_reminder", "welcome_general"],
        cooldowns: {
            event_reminder: 4,
            welcome_general: 48
        }
    }
};

module.exports = rules;
