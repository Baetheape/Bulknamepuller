import { Actor } from 'apify';
import { requestAsBrowser } from 'apify';
import * as cheerio from 'cheerio';

await Actor.init();

const input = await Actor.getInput() || {};

// Convert bulk pasted text → array of names
const names = input.names
    .split('\n')
    .map(n => n.trim())
    .filter(n => n.length > 0);

// Fetch HTML
async function fetchHtml(url) {
    const { body } = await requestAsBrowser({
        url,
        headers: {
            'User-Agent': 'Mozilla/5.0',
            'Accept-Language': 'en-US,en;q=0.9'
        }
    });
    return cheerio.load(body);
}

// Split name into first + last
function extractName(raw) {
    if (!raw) return { first_name: null, last_name: null };
    const parts = raw.trim().split(/\s+/);
    return {
        first_name: parts[0] || null,
        last_name: parts.slice(1).join(" ") || null
    };
}

// Extract up to 5 phone numbers
function extractPhones($) {
    const phones = [];

    $('a[href^="tel:"]').each((i, el) => {
        if (phones.length >= 5) return;
        const num = $(el).attr('href').replace(/[^\d]/g, '');
        if (num && !phones.includes(num)) phones.push(num);
    });

    return {
        phone_1: phones[0] || null,
        phone_2: phones[1] || null,
        phone_3: phones[2] || null,
        phone_4: phones[3] || null,
        phone_5: phones[4] || null
    };
}

// Search CyberBackgroundChecks by name
async function searchByName(fullName) {
    const encoded = encodeURIComponent(fullName.trim());
    const url = `https://www.cyberbackgroundchecks.com/people?name=${encoded}`;
    const $ = await fetchHtml(url);

    const firstLink = $('a[href*="/people/"]').first().attr('href');
    if (!firstLink) return null;

    return `https://www.cyberbackgroundchecks.com${firstLink}`;
}

// Process a single name
async function handleName(fullName) {
    const profileUrl = await searchByName(fullName);
    if (!profileUrl) {
        await Actor.pushData({
            first_name: null,
            last_name: null,
            phone_1: null,
            phone_2: null,
            phone_3: null,
            phone_4: null,
            phone_5: null
        });
        return;
    }

    const $ = await fetchHtml(profileUrl);

    const rawName = $('h1').first().text().trim();
    const { first_name, last_name } = extractName(rawName);

    const phones = extractPhones($);

    await Actor.pushData({
        first_name,
        last_name,
        ...phones
    });
}

// Run for each name
for (const n of names) {
    try {
        console.log(`Searching for: ${n}`);
        await handleName(n);
    } catch (err) {
        console.log("Error:", n, err.message);
    }
}

await Actor.exit();
