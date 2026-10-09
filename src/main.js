import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import { PlaywrightCrawler, log } from 'crawlee';
import {
    parseProfileHtml,
    parseCompanyHtml,
    parseJobHtml,
    parseJobSearchCards
} from './extractors.js';

await Actor.init();

const input = (await Actor.getInput()) || {};
const {
    mode = 'AUTO_DETECT',
    targetUrls = [],
    searchKeywords = [],
    searchLocation = 'United States',
    maxItems = 30,
    liAtCookie = '',
    proxyConfiguration
} = input;

log.info('🚀 Starting LinkedIn Ultimate Scraper...', {
    mode,
    targetUrlsCount: targetUrls.length,
    searchKeywordsCount: searchKeywords.length,
    searchLocation
});

const proxyConfig = proxyConfiguration ? await Actor.createProxyConfiguration(proxyConfiguration) : undefined;

// Default sample targets if nothing provided
let urlsToProcess = [...targetUrls];
let keywordsToProcess = [...searchKeywords];

if (urlsToProcess.length === 0 && keywordsToProcess.length === 0) {
    urlsToProcess = [
        'https://www.linkedin.com/in/satyanadella/',
        'https://www.linkedin.com/company/microsoft/'
    ];
    log.info('ℹ️ No inputs provided. Defaulting to sample profile and company targets.');
}

function buildHeaders() {
    const headers = {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Upgrade-Insecure-Requests': '1'
    };
    if (liAtCookie) {
        headers['Cookie'] = `li_at=${liAtCookie.trim()};`;
    }
    return headers;
}

// Fast HTML fetcher
async function fetchHtml(url) {
    const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
    const response = await gotScraping({
        url,
        headers: buildHeaders(),
        proxyUrl,
        timeout: { request: 25000 },
        retry: { limit: 2 }
    });
    return response.body;
}

// Playwright fallback for tricky pages or authwalls
async function fetchWithPlaywright(url) {
    let content = '';
    const crawler = new PlaywrightCrawler({
        proxyConfiguration: proxyConfig,
        maxRequestsPerCrawl: 1,
        headless: true,
        requestHandlerTimeoutSecs: 35,
        async requestHandler({ page }) {
            if (liAtCookie) {
                await page.context().addCookies([{
                    name: 'li_at',
                    value: liAtCookie.trim(),
                    domain: '.linkedin.com',
                    path: '/'
                }]);
                await page.reload();
            }
            content = await page.content();
        }
    });
    await crawler.run([url]);
    return content;
}

// Auto-detect mode per URL
function detectUrlMode(url, explicitMode) {
    if (explicitMode && explicitMode !== 'AUTO_DETECT') return explicitMode;
    const lower = url.toLowerCase();
    if (lower.includes('/in/')) return 'PROFILES';
    if (lower.includes('/company/')) return 'COMPANIES';
    if (lower.includes('/jobs/view/') || lower.includes('/jobs/')) return 'JOBS';
    if (lower.includes('/posts/') || lower.includes('/feed/update/')) return 'POSTS';
    return 'PROFILES';
}

const stats = {
    profiles: 0,
    companies: 0,
    jobs: 0,
    jobSearchResults: 0,
    posts: 0,
    failed: 0
};

// 1. PROCESS TARGET URLS
for (const rawUrl of urlsToProcess) {
    const url = rawUrl.trim();
    if (!url) continue;

    const currentMode = detectUrlMode(url, mode);
    log.info(`🎯 Processing [${currentMode}]: ${url}`);

    try {
        let html = '';
        try {
            html = await fetchHtml(url);
        } catch (fetchErr) {
            log.warning(`⚠️ HTTP fetch error for ${url} (${fetchErr.message}). Fallback to browser...`);
            html = await fetchWithPlaywright(url);
        }

        if (currentMode === 'PROFILES') {
            const profile = parseProfileHtml(html, url);
            if (profile) {
                await Actor.pushData(profile);
                stats.profiles++;
                log.info(`✅ Successfully scraped Profile: ${profile.fullName} (${profile.headline || 'No headline'})`);
            }
        } else if (currentMode === 'COMPANIES') {
            const company = parseCompanyHtml(html, url);
            if (company) {
                await Actor.pushData(company);
                stats.companies++;
                log.info(`✅ Successfully scraped Company: ${company.companyName} [Size: ${company.companySize || 'Unknown'}]`);
            }
        } else if (currentMode === 'JOBS') {
            const job = parseJobHtml(html, url);
            if (job) {
                await Actor.pushData(job);
                stats.jobs++;
                log.info(`✅ Successfully scraped Job: "${job.jobTitle}" at ${job.jobCompany || 'Unknown'}`);
            }
        }
    } catch (err) {
        log.error(`❌ Failed processing ${url}: ${err.message}`);
        stats.failed++;
    }
}

// 2. PROCESS PUBLIC JOBS SEARCH (NO-COOKIE)
if (keywordsToProcess.length > 0) {
    for (const keyword of keywordsToProcess) {
        log.info(`🔍 Searching LinkedIn Jobs for: "${keyword}" in "${searchLocation}"`);
        let collected = 0;
        let start = 0;

        while (collected < maxItems) {
            try {
                const searchApiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(searchLocation)}&start=${start}`;
                let html = '';
                try {
                    html = await fetchHtml(searchApiUrl);
                } catch (_) {
                    html = await fetchWithPlaywright(searchApiUrl);
                }

                const jobCards = parseJobSearchCards(html);
                if (jobCards.length === 0) break;

                for (const card of jobCards) {
                    if (collected >= maxItems) break;
                    card.searchKeyword = keyword;
                    card.searchLocation = searchLocation;
                    await Actor.pushData(card);
                    collected++;
                    stats.jobSearchResults++;
                }

                start += 25;
                log.info(`📜 Fetched ${collected}/${maxItems} jobs for "${keyword}"...`);
            } catch (err) {
                log.error(`❌ Jobs search error for "${keyword}": ${err.message}`);
                stats.failed++;
                break;
            }
        }
        log.info(`✅ Finished jobs search for "${keyword}". Extracted ${collected} jobs.`);
    }
}

// Save summary report
const summary = {
    status: 'COMPLETED',
    timestamp: new Date().toISOString(),
    metrics: stats,
    totalRecordsExtracted: stats.profiles + stats.companies + stats.jobs + stats.jobSearchResults + stats.posts,
    message: 'LinkedIn Ultimate Scraper completed successfully.'
};

await Actor.setValue('OUTPUT', summary);
log.info('🏁 Execution Finished. Executive Summary:', summary);

await Actor.exit();
