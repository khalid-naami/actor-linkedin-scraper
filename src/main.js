import { Actor } from 'apify';
import { gotScraping } from 'got-scraping';
import { PlaywrightCrawler, RequestQueue, log } from 'crawlee';
import {
    isBlockedOrAuthwall,
    parseProfileHtml,
    parseCompanyHtml,
    parseJobHtml,
    parseJobSearchCards,
    parsePostHtml,
    sanitizeRecord,
} from './extractors.js';

await Actor.init();

try {
    const input = (await Actor.getInput()) || {};
    const {
        mode = 'AUTO_DETECT',
        targetUrls = [],
        searchKeywords = [],
        searchLocation = 'United States',
        maxItems = 30,
        liAtCookie = '',
        proxyConfiguration,
    } = input;

    const safeMaxItems = Math.max(1, Math.min(5000, Number(maxItems) || 30));

    log.info('🚀 Starting LinkedIn Ultimate Scraper...', {
        mode,
        targetUrlsCount: targetUrls.length,
        searchKeywordsCount: searchKeywords.length,
        searchLocation,
        maxItems: safeMaxItems,
        hasCookie: Boolean(liAtCookie && liAtCookie.trim()),
    });

    let proxyConfig;
    if (proxyConfiguration) {
        try {
            proxyConfig = await Actor.createProxyConfiguration(proxyConfiguration);
        } catch (proxyErr) {
            log.warning(`⚠️ Proxy configuration skipped (${proxyErr.message}). Falling back to direct connection.`);
        }
    }

    const urlsToProcess = Array.isArray(targetUrls) ? targetUrls.map((u) => String(u || '').trim()).filter(Boolean) : [];
    const keywordsToProcess = Array.isArray(searchKeywords) ? searchKeywords.map((k) => String(k || '').trim()).filter(Boolean) : [];

    if (urlsToProcess.length === 0 && keywordsToProcess.length === 0) {
        if (mode === 'JOBS_SEARCH') {
            keywordsToProcess.push('full stack engineer');
            log.info('ℹ️ No keywords provided for JOBS_SEARCH. Defaulting to sample keyword:', { keywords: keywordsToProcess });
        } else {
            urlsToProcess.push(
                'https://www.linkedin.com/in/satyanadella/',
                'https://www.linkedin.com/company/microsoft/'
            );
            log.info('ℹ️ No inputs provided. Defaulting to sample profile and company targets.');
        }
    }

    async function fetchHtml(url) {
        const proxyUrl = proxyConfig ? await proxyConfig.newUrl() : undefined;
        const extraHeaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        };
        if (liAtCookie && liAtCookie.trim()) {
            extraHeaders.Cookie = `li_at=${liAtCookie.trim()};`;
        }

        const response = await gotScraping({
            url,
            proxyUrl,
            headerGeneratorOptions: {
                browsers: ['chrome'],
                operatingSystems: ['windows', 'macos', 'linux'],
                locales: ['en-US'],
            },
            headers: extraHeaders,
            timeout: { request: 25000 },
            retry: { limit: 2 },
            throwHttpErrors: true,
        });
        return {
            html: response.body,
            finalUrl: response.url || url,
            statusCode: response.statusCode || 200,
        };
    }

    async function fetchWithPlaywright(url) {
        let content = '';
        let finalUrl = url;
        let statusCode = 0;
        const queueName = `li-pw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const requestQueue = await RequestQueue.open(queueName);

        try {
            const crawler = new PlaywrightCrawler({
                requestQueue,
                proxyConfiguration: proxyConfig,
                maxRequestsPerCrawl: 1,
                maxRequestRetries: 1,
                headless: true,
                requestHandlerTimeoutSecs: 35,
                preNavigationHooks: [
                    async ({ page }, gotoOptions) => {
                        gotoOptions.waitUntil = 'domcontentloaded';
                        if (liAtCookie && liAtCookie.trim()) {
                            await page.context().addCookies([{
                                name: 'li_at',
                                value: liAtCookie.trim(),
                                domain: '.linkedin.com',
                                path: '/',
                            }]);
                        }
                    },
                ],
                async requestHandler({ page, response }) {
                    statusCode = response ? response.status() : 200;
                    finalUrl = page.url();
                    await page.waitForSelector('script[type="application/ld+json"], .top-card-layout, .base-search-card', { timeout: 6000 }).catch(() => {});
                    content = await page.content();
                },
            });
            await crawler.run([url]);
        } finally {
            await requestQueue.drop().catch(() => {});
        }
        return { html: content, finalUrl, statusCode: statusCode || 200 };
    }

    async function fetchLinkedInPage(url) {
        try {
            const res = await fetchHtml(url);
            if (!isBlockedOrAuthwall(res.html, res.finalUrl, res.statusCode)) {
                return res;
            }
            throw new Error(`HTTP ${res.statusCode} / LinkedIn authwall or anti-bot challenge`);
        } catch (fetchErr) {
            log.warning(`⚠️ HTTP fetch blocked/failed for ${url} (${fetchErr.message}). Fallback to Playwright...`);
            const pwRes = await fetchWithPlaywright(url);
            if (isBlockedOrAuthwall(pwRes.html, pwRes.finalUrl, pwRes.statusCode)) {
                throw new Error(`Blocked by LinkedIn anti-bot or authwall (HTTP ${pwRes.statusCode}). Try Residential proxy or a valid liAtCookie.`);
            }
            return pwRes;
        }
    }

    function detectUrlMode(url, explicitMode) {
        const lower = url.toLowerCase();
        if (lower.includes('/company/') || lower.includes('/school/')) return 'COMPANIES';
        if (lower.includes('/jobs/view/') || lower.includes('/jobposting/')) return 'JOBS';
        if (lower.includes('/posts/') || lower.includes('/feed/update/') || lower.includes('/pulse/')) return 'POSTS';
        if (lower.includes('/in/')) return 'PROFILES';
        if (explicitMode && explicitMode !== 'AUTO_DETECT') return explicitMode;
        return 'PROFILES';
    }

    const stats = {
        profiles: 0,
        companies: 0,
        jobs: 0,
        jobSearchResults: 0,
        posts: 0,
        failed: 0,
    };
    const diagnostics = [];

    // 1. PROCESS TARGET URLS (skip if explicit JOBS_SEARCH mode and user also passed keywords, unless targetUrls explicitly non-empty)
    if (mode !== 'JOBS_SEARCH' && urlsToProcess.length > 0) {
        for (const url of urlsToProcess.slice(0, safeMaxItems)) {
            const currentMode = detectUrlMode(url, mode);
            log.info(`🎯 Processing [${currentMode}]: ${url}`);

            try {
                let pageRes;
                try {
                    pageRes = await fetchLinkedInPage(url);
                } catch (primaryErr) {
                    const jobIdMatch = url.match(/\/jobs\/view\/(?:[^/]*?-)?(\d+)/i);
                    if (currentMode === 'JOBS' && jobIdMatch) {
                        const guestJobUrl = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${jobIdMatch[1]}`;
                        pageRes = await fetchLinkedInPage(guestJobUrl);
                    } else {
                        throw primaryErr;
                    }
                }

                if (currentMode === 'PROFILES') {
                    const profile = parseProfileHtml(pageRes.html, url);
                    if (!profile) throw new Error('Profile could not be parsed (missing JSON-LD / authwall)');
                    await Actor.pushData(profile);
                    stats.profiles++;
                    log.info(`✅ Successfully scraped Profile: ${profile.fullName} (${profile.headline || 'No headline'})`);
                } else if (currentMode === 'COMPANIES') {
                    const company = parseCompanyHtml(pageRes.html, url);
                    if (!company) throw new Error('Company page could not be parsed (missing Organization data / authwall)');
                    await Actor.pushData(company);
                    stats.companies++;
                    log.info(`✅ Successfully scraped Company: ${company.companyName} [Size: ${company.companySize || 'Unknown'}]`);
                } else if (currentMode === 'JOBS') {
                    const job = parseJobHtml(pageRes.html, url);
                    if (!job) throw new Error('Job posting could not be parsed');
                    await Actor.pushData(job);
                    stats.jobs++;
                    log.info(`✅ Successfully scraped Job: "${job.jobTitle}" at ${job.jobCompany || 'Unknown'}`);
                } else if (currentMode === 'POSTS') {
                    const post = parsePostHtml(pageRes.html, url);
                    if (!post) throw new Error('Post could not be parsed');
                    await Actor.pushData(post);
                    stats.posts++;
                    log.info(`✅ Successfully scraped Post by ${post.postAuthor || 'Author'} [Likes: ${post.postLikesCount ?? 0}]`);
                }
            } catch (err) {
                log.error(`❌ Failed processing ${url}: ${err.message}`);
                stats.failed++;
                diagnostics.push(`${url}: ${err.message}`);
            }
        }
    }

    // 2. PROCESS PUBLIC JOBS SEARCH (NO-COOKIE)
    if (keywordsToProcess.length > 0 && (mode === 'AUTO_DETECT' || mode === 'JOBS_SEARCH' || mode === 'JOBS' || mode === 'PROFILES')) {
        for (const keyword of keywordsToProcess) {
            log.info(`🔍 Searching LinkedIn Jobs for: "${keyword}" in "${searchLocation}"`);
            let collected = 0;
            let start = 0;
            const seenJobIds = new Set();

            while (collected < safeMaxItems) {
                try {
                    const searchApiUrl = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(searchLocation)}&start=${start}`;
                    const res = await fetchHtml(searchApiUrl).catch(() => fetchWithPlaywright(searchApiUrl));
                    if (isBlockedOrAuthwall(res.html, res.finalUrl, res.statusCode)) {
                        throw new Error(`Jobs search blocked (HTTP ${res.statusCode})`);
                    }

                    const jobCards = parseJobSearchCards(res.html);
                    if (jobCards.length === 0) break;

                    let addedThisPage = 0;
                    for (const card of jobCards) {
                        if (collected >= safeMaxItems) break;
                        const dedupeKey = card.id || card.url;
                        if (seenJobIds.has(dedupeKey)) continue;
                        seenJobIds.add(dedupeKey);

                        const enriched = sanitizeRecord({
                            ...card,
                            searchKeyword: keyword,
                            searchLocation: searchLocation || undefined,
                        });
                        await Actor.pushData(enriched);
                        collected++;
                        addedThisPage++;
                        stats.jobSearchResults++;
                    }

                    if (addedThisPage === 0) break;
                    start += jobCards.length;
                    log.info(`📜 Fetched ${collected}/${safeMaxItems} jobs for "${keyword}"...`);
                } catch (err) {
                    log.error(`❌ Jobs search error for "${keyword}": ${err.message}`);
                    stats.failed++;
                    diagnostics.push(`Jobs search "${keyword}": ${err.message}`);
                    break;
                }
            }
            log.info(`✅ Finished jobs search for "${keyword}". Extracted ${collected} jobs.`);
        }
    }

    const totalRecordsExtracted = stats.profiles + stats.companies + stats.jobs + stats.jobSearchResults + stats.posts;
    const summary = {
        status: totalRecordsExtracted > 0 ? 'COMPLETED' : 'FAILED',
        timestamp: new Date().toISOString(),
        metrics: stats,
        totalRecordsExtracted,
        diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
        message: totalRecordsExtracted > 0
            ? 'LinkedIn Ultimate Scraper completed successfully.'
            : 'LinkedIn Ultimate Scraper extracted 0 records.',
    };

    await Actor.setValue('OUTPUT', summary);
    log.info('🏁 Execution Finished. Executive Summary:', summary);

    if (totalRecordsExtracted === 0) {
        const reason = diagnostics.length > 0 ? diagnostics.join('; ') : 'No valid LinkedIn profiles, companies, jobs, or posts matched.';
        await Actor.fail(`Extracted 0 LinkedIn records. ${reason}`);
    }
} catch (fatalErr) {
    log.exception(fatalErr, '💥 Fatal error in LinkedIn Ultimate Scraper');
    await Actor.fail(fatalErr.message);
} finally {
    await Actor.exit();
}
