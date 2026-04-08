/**
 * Shared utilities for the Wedding Butler project.
 */

/**
 * Normalize a phone number to +91XXXXXXXXXX format.
 * Strips spaces, dashes, and adds +91 prefix if missing.
 * @param {string} phone - Raw phone input
 * @returns {string} Normalized phone string
 */
function normalizePhone(phone) {
    if (!phone) return '';
    phone = phone.toString().trim().replace(/[\s-]/g, '');
    if (!phone.startsWith('+')) phone = '+91' + phone;
    return phone;
}

/**
 * Compare two phone numbers for equality.
 * Handles cases with/without country code prefix.
 * @param {string} phone1
 * @param {string} phone2
 * @returns {boolean}
 */
function phonesMatch(phone1, phone2) {
    if (!phone1 || !phone2) return false;
    const clean1 = phone1.replace(/\D/g, '');
    const clean2 = phone2.replace(/\D/g, '');
    return clean1.endsWith(clean2) || clean2.endsWith(clean1);
}

/**
 * Sanitize a string for safe HTML insertion.
 * Prevents XSS by escaping HTML special characters.
 * @param {string} str - Raw string
 * @returns {string} Sanitized string
 */
function sanitizeHTML(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

module.exports = { normalizePhone, phonesMatch, sanitizeHTML };
