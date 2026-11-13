/**
 * LinkedIn Ultimate Scraper - Extractors & Parsers
 * High-precision extraction for People Profiles, Companies, Jobs, Job Search Cards, and Posts.
 */

const ENTITY_MAP = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    middot: '·',
};

export function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string') return '';
    return str
        .replace(/&([a-zA-Z]+);/g, (full, name) => ENTITY_MAP[name.toLowerCase()] ?? full)
        .replace(/&#(\d+);/g, (full, dec) => {
            const cp = Number.parseInt(dec, 10);
            return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
        })
        .replace(/&#x([0-9a-fA-F]+);/g, (full, hex) => {
            const cp = Number.parseInt(hex, 16);
            return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : full;
        });
}

export function sanitizeRecord(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => sanitizeRecord(item))
            .filter((item) => item !== null && item !== undefined && !(typeof item === 'number' && !Number.isFinite(item)));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === null || v === undefined) continue;
            if (typeof v === 'number' && !Number.isFinite(v)) continue;
            if (Array.isArray(v)) {
                out[k] = sanitizeRecord(v);
            } else if (typeof v === 'object') {
                out[k] = sanitizeRecord(v);
            } else {
                out[k] = v;
            }
        }
        return out;
    }
    return value;
}

function stripTags(html) {
    if (!html || typeof html !== 'string') return '';
    return decodeHtmlEntities(
        html
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
    )
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}

export function extractMetaContent(html, key) {
    if (!html || typeof html !== 'string') return undefined;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regexes = [
        new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i'),
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'),
    ];
    for (const re of regexes) {
        const m = html.match(re);
        if (m && m[1]) return decodeHtmlEntities(m[1]).trim();
    }
    return undefined;
}

export function isBlockedOrAuthwall(html, finalUrl = '', statusCode = 200) {
    if (statusCode === 403 || statusCode === 429 || statusCode === 999) return true;
    const lowerUrl = String(finalUrl || '').toLowerCase();
    if (lowerUrl.includes('/authwall') || lowerUrl.includes('/checkpoint')) return true;
    if (!html || typeof html !== 'string') return true;
    if (html.includes('http-equiv="refresh" content="1;url=https://www.linkedin.com"')) return true;
    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').trim();
    if (/^(?:just a moment\.{0,3}|sign in\s*\|\s*linkedin|security verification\s*\|\s*linkedin|join linkedin)/i.test(title)) {
        return true;
    }
    return false;
}

export function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const matches = text.match(emailRegex) || [];
    const ignored = ['linkedin.com', 'licdn.com', 'example.com', 'sentry.io'];
    const unique = [...new Set(matches.map((m) => m.trim().toLowerCase()))];
    return unique.filter((e) => !ignored.some((d) => e.endsWith(`@${d}`)));
}

export function extractPhones(text) {
    if (!text || typeof text !== 'string') return [];
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g;
    const matches = text.match(phoneRegex) || [];
    const valid = matches
        .map((p) => p.trim())
        .filter((p) => {
            const digits = p.replace(/\D/g, '');
            return digits.length >= 8 && digits.length <= 15;
        });
    return [...new Set(valid)];
}

export function extractSocialLinks(text) {
    if (!text || typeof text !== 'string') return [];
    const socials = [];
    const patterns = [
        { platform: 'twitter_x', regex: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi },
        { platform: 'github', regex: /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_.-]+/gi },
        { platform: 'instagram', regex: /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._-]+/gi },
        { platform: 'youtube', regex: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|user\/|channel\/|@)[a-zA-Z0-9_.-]+/gi },
        { platform: 'telegram', regex: /https?:\/\/(?:t\.me|telegram\.me)\/[a-zA-Z0-9_]+/gi },
    ];

    for (const { platform, regex } of patterns) {
        const matches = text.match(regex);
        if (matches) {
            for (const url of matches) {
                const cleanUrl = url.replace(/[.,;!?)]+$/, '');
                if (!socials.some((s) => s.url === cleanUrl)) {
                    socials.push({ platform, url: cleanUrl });
                }
            }
        }
    }
    return socials;
}

export function extractJsonLd(html) {
    if (!html || typeof html !== 'string') return [];
    const blocks = [];
    const regex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1]);
            if (Array.isArray(parsed)) {
                blocks.push(...parsed);
            } else if (parsed && Array.isArray(parsed['@graph'])) {
                blocks.push(...parsed['@graph']);
            } else if (parsed && typeof parsed === 'object') {
                blocks.push(parsed);
            }
        } catch {
            // ignore invalid ld+json
        }
    }
    return blocks;
}

// Parse Person Profile HTML & JSON-LD
export function parseProfileHtml(html, url = '') {
    if (!html || isBlockedOrAuthwall(html, url)) return null;

    const slugMatch = url.match(/\/in\/([a-zA-Z0-9_.-]+)/i);
    const slug = slugMatch ? slugMatch[1] : undefined;

    const jsonLds = extractJsonLd(html);
    const personLd = jsonLds.find((j) => j?.['@type'] === 'Person') || {};

    let fullName = personLd.name ? decodeHtmlEntities(String(personLd.name)).trim() : '';

    // Handle jobTitle whether string or array (e.g. ["Chairman and CEO", "Member Board Of Trustees"])
    const rawJobTitles = Array.isArray(personLd.jobTitle)
        ? personLd.jobTitle.map((t) => decodeHtmlEntities(String(t)).trim()).filter(Boolean)
        : (personLd.jobTitle ? [decodeHtmlEntities(String(personLd.jobTitle)).trim()] : []);

    let headline = rawJobTitles.join(' · ');
    const currentPosition = rawJobTitles[0] || undefined;

    let about = personLd.description ? stripTags(String(personLd.description)) : '';
    let profilePictureUrl = personLd.image?.contentUrl
        || (typeof personLd.image === 'string' ? personLd.image : undefined);
    if (profilePictureUrl) profilePictureUrl = decodeHtmlEntities(profilePictureUrl);

    let location;
    if (personLd.address && typeof personLd.address === 'object') {
        const addr = personLd.address;
        const loc = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ');
        if (loc) location = decodeHtmlEntities(loc);
    }

    const ogTitle = extractMetaContent(html, 'og:title');
    if (!fullName && ogTitle) {
        const cleanedTitle = ogTitle.replace(/\s*\|\s*LinkedIn.*$/i, '').trim();
        const parts = cleanedTitle.split(/\s+[-–]\s+/);
        fullName = parts[0]?.trim() || '';
        if (parts[1] && !headline) headline = parts.slice(1).join(' - ').trim();
    }

    if (!headline) {
        const hMatch = html.match(/<h2[^>]*class="[^"]*top-card-layout__headline[^"]*"[^>]*>([\s\S]*?)<\/h2>/i)
            || html.match(/class="[^"]*text-body-medium[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (hMatch) headline = stripTags(hMatch[1]);
    }

    if (!about) {
        const ogDesc = extractMetaContent(html, 'og:description');
        const aMatch = html.match(/class="[^"]*summary[^"]*"[^>]*>([\s\S]*?)<\/section>/i)
            || html.match(/class="[^"]*core-section-container__content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        about = aMatch ? stripTags(aMatch[1]) : (ogDesc || '');
    }

    if (!profilePictureUrl) {
        const ogImg = extractMetaContent(html, 'og:image');
        if (ogImg && !ogImg.includes('ghost-person')) profilePictureUrl = ogImg;
    }

    const bannerMatch = html.match(/class="[^"]*cover-img__image[^"]*"[^>]*src="([^"]+)"/i)
        || html.match(/class="[^"]*background-image__image[^"]*"[^>]*data-delayed-url="([^"]+)"/i);
    const bannerUrl = bannerMatch ? decodeHtmlEntities(bannerMatch[1]) : undefined;

    const followersMatch = html.match(/([\d.,]+[KM]?)\s+followers/i);
    const connectionsMatch = html.match(/([\d.,]+\+?)\s+connections/i);
    const connParts = [];
    if (followersMatch) connParts.push(`${followersMatch[1]} followers`);
    if (connectionsMatch) connParts.push(`${connectionsMatch[1]} connections`);
    const connectionsCount = connParts.length > 0 ? connParts.join(', ') : undefined;

    let currentCompany;
    if (personLd.worksFor) {
        const firstWork = Array.isArray(personLd.worksFor) ? personLd.worksFor[0] : personLd.worksFor;
        if (firstWork?.name) currentCompany = decodeHtmlEntities(String(firstWork.name)).trim();
    }
    if (!currentCompany && headline) {
        const atMatch = headline.match(/\bat\s+([^·|,(]+)$/i);
        if (atMatch) currentCompany = atMatch[1].trim();
    }

    const education = [];
    const experience = [];
    if (personLd.alumniOf) {
        const arr = Array.isArray(personLd.alumniOf) ? personLd.alumniOf : [personLd.alumniOf];
        for (const item of arr) {
            if (!item) continue;
            const itemName = decodeHtmlEntities(String(item.name || item)).trim();
            if (!itemName) continue;
            if (item['@type'] === 'EducationalOrganization' || /university|college|school|institute|academy/i.test(itemName)) {
                education.push(sanitizeRecord({
                    school: itemName,
                    url: item.url || undefined,
                    startDate: item.member?.startDate ? String(item.member.startDate) : undefined,
                    endDate: item.member?.endDate ? String(item.member.endDate) : undefined,
                }));
            } else {
                experience.push(sanitizeRecord({
                    organization: itemName,
                    url: item.url || undefined,
                    startDate: item.member?.startDate ? String(item.member.startDate) : undefined,
                    endDate: item.member?.endDate ? String(item.member.endDate) : undefined,
                }));
            }
        }
    }

    if (!fullName && !slug) return null;

    const resolvedName = fullName || slug;
    const nameParts = resolvedName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    const combinedText = `${resolvedName} ${headline} ${about}`;
    const emails = extractEmails(combinedText);
    const phones = extractPhones(combinedText);
    const socialLinks = extractSocialLinks(combinedText);

    return sanitizeRecord({
        type: 'PROFILE',
        id: slug || resolvedName.toLowerCase().replace(/\s+/g, '-'),
        url,
        fullName: resolvedName,
        firstName,
        lastName,
        headline: headline || undefined,
        currentCompany,
        currentPosition,
        location,
        about: about || undefined,
        experience: experience.length > 0 ? experience : undefined,
        education: education.length > 0 ? education : undefined,
        connectionsCount,
        profilePictureUrl,
        bannerUrl,
        email: emails[0],
        emails: emails.length > 0 ? emails : undefined,
        phone: phones[0],
        phones: phones.length > 0 ? phones : undefined,
        socialLinks: socialLinks.length > 0 ? socialLinks : undefined,
        scrapedAt: new Date().toISOString(),
    });
}

// Parse Company Profile HTML & JSON-LD
export function parseCompanyHtml(html, url = '') {
    if (!html || isBlockedOrAuthwall(html, url)) return null;

    const slugMatch = url.match(/\/company\/([a-zA-Z0-9_.-]+)/i);
    const slug = slugMatch ? slugMatch[1] : undefined;

    const jsonLds = extractJsonLd(html);
    const orgLd = jsonLds.find((j) => j?.['@type'] === 'Organization') || {};

    let companyName = orgLd.name ? decodeHtmlEntities(String(orgLd.name)).trim() : '';
    let companyIndustry = '';
    let companySize = '';
    let companyWebsite = orgLd.sameAs || orgLd.url || undefined;
    if (Array.isArray(companyWebsite)) companyWebsite = companyWebsite[0];
    let companyHq;
    let logoUrl = typeof orgLd.logo === 'string'
        ? orgLd.logo
        : (orgLd.logo?.contentUrl || orgLd.logo?.url || undefined);
    let about = orgLd.description ? stripTags(String(orgLd.description)) : '';

    if (orgLd.address && typeof orgLd.address === 'object') {
        const a = orgLd.address;
        const hq = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
        if (hq) companyHq = decodeHtmlEntities(hq);
    }

    if (orgLd.numberOfEmployees) {
        companySize = typeof orgLd.numberOfEmployees === 'object'
            ? String(orgLd.numberOfEmployees.value || '')
            : String(orgLd.numberOfEmployees);
    }

    if (!companyName) {
        const h1Match = html.match(/<h1[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h1>/i);
        const ogTitle = extractMetaContent(html, 'og:title');
        companyName = h1Match ? stripTags(h1Match[1]) : (ogTitle ? ogTitle.replace(/\s*\|\s*LinkedIn.*$/i, '').trim() : '');
    }

    const taglineMatch = html.match(/<h4[^>]*top-card-layout__second-subline[^>]*>([\s\S]*?)<\/h4>/i);
    const companyTagline = taglineMatch ? stripTags(taglineMatch[1]) : undefined;

    const sublineMatch = html.match(/<h2[^>]*top-card-layout__headline[^>]*>([\s\S]*?)<\/h2>/i);
    if (!companyIndustry && sublineMatch) {
        companyIndustry = stripTags(sublineMatch[1]);
    }

    if (!about) {
        about = extractMetaContent(html, 'og:description') || '';
    }

    if (!logoUrl) {
        const ogImg = extractMetaContent(html, 'og:image');
        if (ogImg && !ogImg.includes('ghost-company')) logoUrl = ogImg;
    }

    if (!companyName && !slug) return null;

    const emails = extractEmails(`${about} ${html.slice(0, 5000)}`);
    const phones = extractPhones(`${about} ${html.slice(0, 5000)}`);

    return sanitizeRecord({
        type: 'COMPANY',
        id: slug || companyName.toLowerCase().replace(/\s+/g, '-'),
        url,
        companyName: companyName || slug,
        companyTagline,
        companyIndustry: companyIndustry || undefined,
        companySize: companySize || undefined,
        companyWebsite: companyWebsite ? decodeHtmlEntities(String(companyWebsite)) : undefined,
        companyHq,
        about: about || undefined,
        profilePictureUrl: logoUrl ? decodeHtmlEntities(String(logoUrl)) : undefined,
        email: emails[0],
        emails: emails.length > 0 ? emails : undefined,
        phone: phones[0],
        phones: phones.length > 0 ? phones : undefined,
        scrapedAt: new Date().toISOString(),
    });
}

// Parse Job Posting HTML & JSON-LD (handles both /jobs/view/<id> and /jobs-guest/jobs/api/jobPosting/<id>)
export function parseJobHtml(html, url = '') {
    if (!html || isBlockedOrAuthwall(html, url)) return null;

    const idMatch = url.match(/\/jobs\/view\/(?:[^/]*?-)?(\d+)/i)
        || url.match(/jobPosting\/(\d+)/i)
        || url.match(/\/(\d+)(?:\/|\?|$)/);
    const jobId = idMatch ? idMatch[1] : undefined;

    const jsonLds = extractJsonLd(html);
    const jobLd = jsonLds.find((j) => j?.['@type'] === 'JobPosting') || {};

    let jobTitle = jobLd.title
        ? decodeHtmlEntities(String(jobLd.title)).trim()
        : (stripTags(html.match(/<h[12][^>]*class="[^"]*top-card-layout__title[^"]*"[^>]*>([\s\S]*?)<\/h[12]>/i)?.[1] || '')
            || (extractMetaContent(html, 'og:title') || '').replace(/\s*\|\s*LinkedIn.*$/i, '').trim());

    let hiringOrg = jobLd.hiringOrganization?.name
        ? decodeHtmlEntities(String(jobLd.hiringOrganization.name)).trim()
        : stripTags(html.match(/class="[^"]*topcard__org-name-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');

    const datePosted = jobLd.datePosted
        || html.match(/<time[^>]*datetime="([^"]+)"/i)?.[1]
        || undefined;

    let employmentType = jobLd.employmentType ? String(jobLd.employmentType) : undefined;
    let jobSeniority;

    const criteriaRegex = /<h3[^>]*description__job-criteria-subheader[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<span[^>]*description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/gi;
    let cMatch;
    while ((cMatch = criteriaRegex.exec(html)) !== null) {
        const label = stripTags(cMatch[1]).toLowerCase();
        const val = stripTags(cMatch[2]);
        if (!val) continue;
        if (label.includes('seniority')) jobSeniority = val;
        else if (label.includes('employment') && !employmentType) employmentType = val;
    }

    let description = jobLd.description ? stripTags(String(jobLd.description)) : '';
    if (!description) {
        const descMatch = html.match(/class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (descMatch) description = stripTags(descMatch[1]);
    }

    let location;
    if (jobLd.jobLocation?.address && typeof jobLd.jobLocation.address === 'object') {
        const a = jobLd.jobLocation.address;
        const loc = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
        if (loc) location = decodeHtmlEntities(loc);
    }
    if (!location) {
        const locMatch = html.match(/class="[^"]*topcard__flavor[^"]*topcard__flavor--bullet[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        if (locMatch) location = stripTags(locMatch[1]);
    }

    if (!jobTitle && !jobId) return null;

    const isRemote = Boolean(
        jobLd.jobLocationType === 'TELECOMMUTE'
        || jobTitle.toLowerCase().includes('remote')
        || location?.toLowerCase().includes('remote')
    );

    const applyMatch = html.match(/id="applyUrl"[^>]*>([^<]+)</i);
    const jobApplyUrl = applyMatch ? decodeHtmlEntities(applyMatch[1].trim()) : undefined;

    return sanitizeRecord({
        type: 'JOB',
        id: jobId,
        url,
        jobTitle: jobTitle || undefined,
        jobCompany: hiringOrg || undefined,
        jobLocation: location,
        jobWorkplaceType: isRemote ? 'Remote' : 'On-site',
        jobEmploymentType: employmentType,
        jobSeniority,
        jobDescription: description || undefined,
        jobApplyUrl,
        datePosted,
        scrapedAt: new Date().toISOString(),
    });
}

// Parse Public Job Search Cards HTML from jobs-guest API
export function parseJobSearchCards(html) {
    if (!html || typeof html !== 'string') return [];
    const jobs = [];

    const liBlocks = html.split(/<li>/i).slice(1);
    for (const block of liBlocks) {
        if (!block.includes('base-card') && !block.includes('job-search-card')) continue;

        const urnMatch = block.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/i);
        const titleMatch = block.match(/<h3[^>]*class="[^"]*base-search-card__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i);
        const title = titleMatch ? stripTags(titleMatch[1]) : '';

        const companyMatch = block.match(/<h4[^>]*class="[^"]*base-search-card__subtitle[^"]*"[^>]*>([\s\S]*?)<\/h4>/i);
        const company = companyMatch ? stripTags(companyMatch[1]) : '';

        const locMatch = block.match(/<span[^>]*class="[^"]*job-search-card__location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
        const loc = locMatch ? stripTags(locMatch[1]) : '';

        const linkMatch = block.match(/<a[^>]*class="[^"]*base-card__full-link[^"]*"[^>]*href="([^"]*)"/i);
        const link = linkMatch ? decodeHtmlEntities(linkMatch[1]).split('?')[0] : '';

        const dateMatch = block.match(/<time[^>]*datetime="([^"]+)"/i);
        const datePosted = dateMatch ? dateMatch[1] : undefined;

        const linkIdMatch = link.match(/-(\d+)(?:\/|\?|$)/) || link.match(/\/(\d+)(?:\/|\?|$)/);
        const jobId = urnMatch ? urnMatch[1] : (linkIdMatch ? linkIdMatch[1] : undefined);

        if (title && link) {
            jobs.push(sanitizeRecord({
                type: 'JOB',
                id: jobId,
                jobTitle: title,
                jobCompany: company || undefined,
                jobLocation: loc || undefined,
                datePosted,
                url: link,
                scrapedAt: new Date().toISOString(),
            }));
        }
    }

    return jobs;
}

// Parse Public Feed Post / Article HTML & JSON-LD
export function parsePostHtml(html, url = '') {
    if (!html || isBlockedOrAuthwall(html, url)) return null;

    const idMatch = url.match(/(?:activity-|ugcPost-|urn:li:activity:)(\d+)/i)
        || url.match(/\/posts\/([^/?#]+)/i);
    const postId = idMatch ? idMatch[1] : undefined;

    const jsonLds = extractJsonLd(html);
    const postLd = jsonLds.find((j) => j?.['@type'] === 'SocialMediaPosting' || j?.['@type'] === 'Article') || {};

    const headline = postLd.headline ? decodeHtmlEntities(String(postLd.headline)).trim() : undefined;
    const rawBody = postLd.articleBody || postLd.text || extractMetaContent(html, 'og:description') || '';
    const postText = stripTags(String(rawBody));

    const postAuthor = postLd.author?.name ? decodeHtmlEntities(String(postLd.author.name)).trim() : undefined;
    const postAuthorUrl = postLd.author?.url || undefined;
    const datePublished = postLd.datePublished || undefined;

    let postLikesCount;
    const stats = Array.isArray(postLd.interactionStatistic)
        ? postLd.interactionStatistic
        : (postLd.interactionStatistic ? [postLd.interactionStatistic] : []);
    const likeStat = stats.find((s) => String(s?.interactionType || '').includes('LikeAction'));
    if (likeStat && Number.isFinite(Number(likeStat.userInteractionCount))) {
        postLikesCount = Number(likeStat.userInteractionCount);
    }

    let postCommentsCount;
    if (Array.isArray(postLd.comment)) {
        postCommentsCount = postLd.comment.length;
    }

    if (!postText && !headline && !postId) return null;

    const emails = extractEmails(postText);
    const phones = extractPhones(postText);
    const socialLinks = extractSocialLinks(postText);

    return sanitizeRecord({
        type: 'POST',
        id: postId,
        url,
        headline,
        postAuthor,
        postAuthorUrl,
        postText: postText || headline || undefined,
        postLikesCount,
        postCommentsCount,
        datePublished,
        email: emails[0],
        emails: emails.length > 0 ? emails : undefined,
        phone: phones[0],
        phones: phones.length > 0 ? phones : undefined,
        socialLinks: socialLinks.length > 0 ? socialLinks : undefined,
        scrapedAt: new Date().toISOString(),
    });
}
