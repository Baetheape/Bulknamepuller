import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() || {};
console.log("RAW INPUT:", input.names);

const names = (input.names || '')
    .split('\n')
    .map(n => n.trim())
    .filter(n => n.length > 0);

console.log("PARSED NAMES:", names);

function splitName(full) {
    if (!full) return { first_name: null, last_name: null };
    const parts = full.trim().split(/\s+/);
    return {
        first_name: parts[0] || null,
        last_name: parts.slice(1).join(' ') || null,
    };
}

function phonesToObject(phones) {
    const clean = [...new Set(
        phones
            .map(p => String(p).replace(/[^\d]/g, ''))
            .filter(p => p.length > 0)
    )].slice(0, 5);

    return {
        phone_1: clean[0] || null,
        phone_2: clean[1] || null,
        phone_3: clean[2] || null,
        phone_4: clean[3] || null,
        phone_5: clean[4] || null,
    };
}

const startRequests = names.map(name => ({
    url: `https://www.cyberbackgroundchecks.com/people?name=${encodeURIComponent(name)}`,
    label: 'SEARCH',
    userData: { inputName: name },
}));

const crawler = new PlaywrightCrawler({
    maxConcurrency: 2,
    navigationTimeoutSecs: 30,

    async requestHandler({ request, page, enqueueLinks, log }) {
        const { label } = request.userData || {};

        if (label === 'SEARCH') {
            const inputName = request.userData.inputName;
            console.log(`\n=== SEARCHING FOR: ${inputName} ===`);
            console.log("SEARCH URL:", request.url);

            await page.waitForLoadState('networkidle').catch(() => {});
            const html = await page.content();
            console.log("SEARCH PAGE HTML LENGTH:", html.length);

            await page.waitForSelector('.people-list-item, a[href^="/people/"]', { timeout: 8000 }).catch(() => {});

            const firstLink = await page.locator('a[href^="/people/"]').first().getAttribute('href');
            console.log("FOUND PROFILE LINK:", firstLink);

            if (!firstLink) {
                console.log("NO PROFILE FOUND — PUSHING EMPTY ROW");
                await Actor.pushData({
                    first_name: null,
                    last_name: null,
                    phone_1: null,
                    phone_2: null,
                    phone_3: null,
                    phone_4: null,
                    phone_5: null,
                });
                return;
            }

            const profileUrl = new URL(firstLink, 'https://www.cyberbackgroundchecks.com').href;
            console.log("PROFILE URL:", profileUrl);

            await enqueueLinks({
                urls: [profileUrl],
                userData: {
                    label: 'PROFILE',
                    inputName,
                },
            });

        } else if (label === 'PROFILE') {
            const inputName = request.userData.inputName;
            console.log(`\n=== LOADING PROFILE FOR: ${inputName} ===`);
            console.log("PROFILE URL:", request.url);

            await page.waitForLoadState('networkidle').catch(() => {});
            const html = await page.content();
            console.log("PROFILE PAGE HTML LENGTH:", html.length);

            let rawName =
                (await page.locator('h1').first().textContent())?.trim() ||
                (await page.locator('.person-name').first().textContent())?.trim() ||
                (await page.locator('.person-header-name').first().textContent())?.trim() ||
                null;

            console.log("EXTRACTED RAW NAME:", rawName);

            const { first_name, last_name } = splitName(rawName || inputName);

            const telHandles = await page.locator('a[href^="tel:"]').all();
            const phones = [];

            for (const h of telHandles) {
                const href = await h.getAttribute('href');
                if (href) phones.push(href);
            }

            console.log("RAW PHONES FOUND:", phones);

            const phoneObj = phonesToObject(phones);

            await Actor.pushData({
                first_name,
                last_name,
                ...phoneObj,
            });
        }
    },

    async failedRequestHandler({ request, log }) {
        console.log("FAILED REQUEST:", request.url);
        await Actor.pushData({
            first_name: null,
            last_name: null,
            phone_1: null,
            phone_2: null,
            phone_3: null,
            phone_4: null,
            phone_5: null,
        });
    },
});

await crawler.run(startRequests);

await Actor.exit();
