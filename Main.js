import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() || {};
const names = (input.names || '')
    .split('\n')
    .map(n => n.trim())
    .filter(n => n.length > 0);

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
    maxConcurrency: 3,
    requestHandlerTimeoutSecs: 60,

    async requestHandler({ request, page, enqueueLinks, log }) {
        const { label } = request.userData || {};

        if (label === 'SEARCH') {
            const inputName = request.userData.inputName;

            await page.waitForTimeout(1500);

            // Wait for search results container OR timeout
            await page.waitForSelector('a[href^="/people/"], .people-list-item', { timeout: 6000 }).catch(() => {});

            const firstLink = await page.locator('a[href^="/people/"]').first().getAttribute('href');

            if (!firstLink) {
                log.info(`No profile found for: ${inputName}`);
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

            await enqueueLinks({
                urls: [profileUrl],
                userData: {
                    label: 'PROFILE',
                    inputName,
                },
            });

        } else if (label === 'PROFILE') {
            const inputName = request.userData.inputName;

            await page.waitForTimeout(1500);

            let rawName =
                (await page.locator('h1').first().textContent())?.trim() ||
                (await page.locator('.person-name').first().textContent())?.trim() ||
                (await page.locator('.person-header-name').first().textContent())?.trim() ||
                null;

            const { first_name, last_name } = splitName(rawName || inputName);

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

await crawler.run(startRequests);

await Actor.exit();
