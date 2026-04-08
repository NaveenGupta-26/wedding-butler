function enforcePersonalization(text, guest) {
    if (!text || !guest) return text;

    const name = guest.name || "Guest";
    const firstName = name.split(' ')[0];

    // Case-insensitive check for name or first name
    const hasName = text.toLowerCase().includes(name.toLowerCase()) ||
        text.toLowerCase().includes(firstName.toLowerCase());

    if (!hasName) {
        // Prepend name with a natural bridge if missing
        if (guest.category === 'elder') {
            return `${firstName} ji, ${text}`;
        } else if (guest.category === 'sibling') {
            return `${firstName}! ${text}`;
        } else {
            return `${firstName}, ${text}`;
        }
    }

    return text;
}

module.exports = { enforcePersonalization };
