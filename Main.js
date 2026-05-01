import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() || {};
const names = (input.names || '')
    .split('\n')
    .map(n => n.trim())
    .filter(n => n.length > 0);

function extractNameParts(full) {
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

const startUrls = names.map(name => ({
    url: `https://www.cyberbackgroundchecks.com/people?name=${encodeURIComponent(name)}`,
    label: 'SEARCH',
    userData: { fullNameInput: name },
}));

const crawler = new PlaywrightCrawler({
    maxConcurrency: 3,
    requestHandlerTimeoutSecs: 60,

    async requestHandler({ request, page, enqueueLinks, log }) {
        const { label } = request.userData || {};

        if (label === 'SEARCH') {
            const fullNameInput = request.userData.fullNameInput;

            // Wait for some content to load
            await page.waitForTimeout(2000);

            // Try to find first profile link
            const firstLinkHandle = await page.locator('a[href^="/people/"]').first();
            const href = await firstLinkHandle.getAttribute('href');

            if (!href) {
                log.info(`No profile found for: ${fullNameInput}`);
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

            const profileUrl = new URL(href, 'https://www.cyberbackgroundchecks.com').href;

            await enqueueLinks({
                urls: [profileUrl],
                userData: {
                    label: 'PROFILE',
                    fullNameInput,
                },
            });

        } else if (label === 'PROFILE') {
            const fullNameInput = request.userData.fullNameInput;

            await page.waitForTimeout(2000);

            // Name extraction
            let rawName = await page.locator('h1').first().textContent();
            if (!rawName || !rawName.trim()) {
                rawName = await page.locator('.person-name').first().textContent();
            }
            if (!rawName || !rawName.trim()) {
                rawName = await page.locator('.person-header-name').first().textContent();
            }
            rawName = rawName ? rawName.trim() : null;

            const { first_name, last_name } = extractNameParts(rawName || fullNameInput);

            // Phone extraction
            const telHandles = await page.locator('a[href^="tel:"]').all();
            const phones = [];
            for (const h of telHandles) {
                const href = await h.getAttribute('href');
                if (href) phones.push(href);
            }

            const phoneObj = phonesToObject(phones);

            await Actor.pushData({
                first_name,
                last_name,
                ...phoneObj,
            });
        }
    },

    async failedRequestHandler({ request, log }) {
        log.error(`Request failed: ${request.url}`);
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

await crawler.run(startUrls);

await Actor.exit();
