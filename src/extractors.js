/**
 * LinkedIn Ultimate Scraper - Extractors & Parsers
 * High-precision extraction for Profiles, Companies, Jobs, and Posts.
 */

// Helper to extract email addresses
export function extractEmails(text) {
    if (!text || typeof text !== 'string') return [];
    const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const matches = text.match(emailRegex) || [];
    const ignored = ['linkedin.com', 'licdn.com', 'example.com', 'sentry.io'];
    const unique = [...new Set(matches.map(m => m.trim().toLowerCase()))];
    return unique.filter(e => !ignored.some(d => e.endsWith(`@${d}`)));
}

// Helper to extract phone numbers
export function extractPhones(text) {
    if (!text || typeof text !== 'string') return [];
    const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g;
    const matches = text.match(phoneRegex) || [];
    const valid = matches
        .map(p => p.trim())
        .filter(p => {
            const digits = p.replace(/\D/g, '');
            return digits.length >= 8 && digits.length <= 15;
        });
    return [...new Set(valid)];
}

// Helper to extract external social & website links
export function extractSocialLinks(text) {
    if (!text || typeof text !== 'string') return [];
    const socials = [];
    const patterns = [
        { platform: 'twitter_x', regex: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[a-zA-Z0-9_]+/gi },
        { platform: 'github', regex: /https?:\/\/(?:www\.)?github\.com\/[a-zA-Z0-9_.-]+/gi },
        { platform: 'instagram', regex: /https?:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._-]+/gi },
        { platform: 'youtube', regex: /https?:\/\/(?:www\.)?youtube\.com\/(?:c\/|user\/|channel\/|@)[a-zA-Z0-9_.-]+/gi },
        { platform: 'telegram', regex: /https?:\/\/(?:t\.me|telegram\.me)\/[a-zA-Z0-9_]+/gi },
        { platform: 'personal_website', regex: /https?:\/\/(?!www\.linkedin\.com|licdn\.com)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?/gi }
    ];

    for (const { platform, regex } of patterns) {
        const matches = text.match(regex);
        if (matches) {
            for (const url of matches) {
                if (!socials.some(s => s.url === url)) {
                    socials.push({ platform, url });
                }
            }
        }
    }
    return socials;
}

// Extract JSON-LD blocks from HTML
export function extractJsonLd(html) {
    if (!html) return [];
    const blocks = [];
    const regex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
        try {
            const parsed = JSON.parse(match[1]);
            if (Array.isArray(parsed)) {
                blocks.push(...parsed);
            } else if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
                blocks.push(...parsed['@graph']);
            } else {
                blocks.push(parsed);
            }
        } catch (_) {}
    }
    return blocks;
}

// Parse Person Profile HTML & JSON-LD
export function parseProfileHtml(html, url) {
    if (!html) return null;

    const slugMatch = url.match(/\/in\/([a-zA-Z0-9_-]+)/i);
    const slug = slugMatch ? slugMatch[1] : null;

    const jsonLds = extractJsonLd(html);
    const personLd = jsonLds.find(j => j['@type'] === 'Person') || {};

    // Basic names and headline
    let fullName = personLd.name || '';
    let headline = personLd.jobTitle || '';
    let about = personLd.description || '';
    let profilePictureUrl = personLd.image?.contentUrl || personLd.image || null;
    let location = null;

    if (personLd.address) {
        const addr = personLd.address;
        location = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ');
    }

    // Fallbacks from OpenGraph and HTML
    if (!fullName) {
        const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)?.[1];
        if (ogTitle) {
            const parts = ogTitle.split(' - ');
            fullName = parts[0].trim();
            if (parts[1] && !headline) headline = parts[1].replace(/\| LinkedIn/gi, '').trim();
        }
    }

    if (!headline) {
        const hMatch = html.match(/<h2 class="top-card-layout__headline[^>]*>([\s\S]*?)<\/h2>/i)
            || html.match(/class="text-body-medium[^>]*>([\s\S]*?)<\/div>/i);
        if (hMatch) headline = hMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    if (!about) {
        const aMatch = html.match(/class="summary[^>]*>([\s\S]*?)<\/section>/i)
            || html.match(/class="core-section-container__content[^>]*>([\s\S]*?)<\/div>/i);
        if (aMatch) about = aMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    if (!profilePictureUrl) {
        const ogImg = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1];
        if (ogImg && !ogImg.includes('ghost-person')) profilePictureUrl = ogImg;
    }

    // Experience and WorksFor
    let currentCompany = null;
    if (personLd.worksFor) {
        currentCompany = Array.isArray(personLd.worksFor)
            ? personLd.worksFor[0]?.name
            : personLd.worksFor.name;
    }

    // Education
    const education = [];
    if (personLd.alumniOf) {
        const arr = Array.isArray(personLd.alumniOf) ? personLd.alumniOf : [personLd.alumniOf];
        for (const item of arr) {
            education.push({
                school: item.name || item,
                degree: item.memberOf || null
            });
        }
    }

    // Names splitting
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Contact lead extraction
    const combinedText = `${fullName} ${headline} ${about} ${html.slice(0, 5000)}`;
    const emails = extractEmails(combinedText);
    const phones = extractPhones(combinedText);
    const socialLinks = extractSocialLinks(combinedText);

    return {
        type: 'PROFILE',
        id: slug,
        url,
        fullName: fullName || slug,
        firstName,
        lastName,
        headline,
        currentCompany,
        location,
        about,
        education: education.length > 0 ? education : undefined,
        profilePictureUrl,
        email: emails[0] || null,
        emails,
        phone: phones[0] || null,
        phones,
        socialLinks,
        scrapedAt: new Date().toISOString()
    };
}

// Parse Company Profile HTML & JSON-LD
export function parseCompanyHtml(html, url) {
    if (!html) return null;

    const slugMatch = url.match(/\/company\/([a-zA-Z0-9_-]+)/i);
    const slug = slugMatch ? slugMatch[1] : null;

    const jsonLds = extractJsonLd(html);
    const orgLd = jsonLds.find(j => j['@type'] === 'Organization') || {};

    let companyName = orgLd.name || '';
    let companyTagline = '';
    let companyIndustry = '';
    let companySize = '';
    let companyWebsite = orgLd.url || null;
    let companyHq = null;
    let logoUrl = orgLd.logo || null;
    let about = orgLd.description || '';

    if (orgLd.address) {
        const a = orgLd.address;
        companyHq = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
    }

    if (orgLd.numberOfEmployees) {
        companySize = typeof orgLd.numberOfEmployees === 'object'
            ? orgLd.numberOfEmployees.value
            : String(orgLd.numberOfEmployees);
    }

    // Fallbacks
    if (!companyName) {
        const ogTitle = html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)?.[1];
        if (ogTitle) companyName = ogTitle.replace(/\| LinkedIn/gi, '').trim();
    }

    if (!logoUrl) {
        logoUrl = html.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)?.[1] || null;
    }

    const emails = extractEmails(`${about} ${html.slice(0, 5000)}`);
    const phones = extractPhones(`${about} ${html.slice(0, 5000)}`);

    return {
        type: 'COMPANY',
        id: slug,
        url,
        companyName: companyName || slug,
        companyTagline,
        companyIndustry,
        companySize,
        companyWebsite,
        companyHq,
        about,
        profilePictureUrl: logoUrl,
        emails: emails.length > 0 ? emails : undefined,
        phones: phones.length > 0 ? phones : undefined,
        scrapedAt: new Date().toISOString()
    };
}

// Parse Job Posting HTML & JSON-LD
export function parseJobHtml(html, url) {
    if (!html) return null;

    const idMatch = url.match(/\/jobs\/view\/(\d+)/i) || url.match(/\/(\d+)(?:\/|\?|$)/);
    const jobId = idMatch ? idMatch[1] : null;

    const jsonLds = extractJsonLd(html);
    const jobLd = jsonLds.find(j => j['@type'] === 'JobPosting') || {};

    const jobTitle = jobLd.title || html.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)?.[1] || '';
    const hiringOrg = jobLd.hiringOrganization?.name || '';
    const datePosted = jobLd.datePosted || null;
    const employmentType = jobLd.employmentType || null;
    const description = jobLd.description ? jobLd.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

    let location = null;
    if (jobLd.jobLocation?.address) {
        const a = jobLd.jobLocation.address;
        location = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ');
    }

    const isRemote = Boolean(
        jobLd.jobLocationType === 'TELECOMMUTE' ||
        jobTitle.toLowerCase().includes('remote') ||
        location?.toLowerCase().includes('remote')
    );

    return {
        type: 'JOB',
        id: jobId,
        url,
        jobTitle,
        jobCompany: hiringOrg,
        jobLocation: location,
        jobWorkplaceType: isRemote ? 'Remote' : 'On-site',
        jobEmploymentType: employmentType,
        jobDescription: description,
        datePosted,
        scrapedAt: new Date().toISOString()
    };
}

// Parse Public Job Search Cards HTML
export function parseJobSearchCards(html) {
    if (!html) return [];
    const jobs = [];

    // Match <li> cards
    const cardRegex = /<div class="base-card[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
    let match;

    while ((match = cardRegex.exec(html)) !== null) {
        const block = match[1];

        const titleMatch = block.match(/<h3 class="base-search-card__title[^>]*>([\s\S]*?)<\/h3>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';

        const companyMatch = block.match(/<h4 class="base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/i);
        const company = companyMatch ? companyMatch[1].replace(/<[^>]+>/g, '').trim() : '';

        const locMatch = block.match(/<span class="job-search-card__location[^>]*>([\s\S]*?)<\/span>/i);
        const loc = locMatch ? locMatch[1].trim() : '';

        const linkMatch = block.match(/<a class="base-card__full-link[^"]*" href="([^"]*)"/i);
        const link = linkMatch ? linkMatch[1].split('?')[0] : '';

        const idMatch = link.match(/\/(\d+)(?:\?|$)/);
        const jobId = idMatch ? idMatch[1] : null;

        if (title && link) {
            jobs.push({
                type: 'JOB',
                id: jobId,
                jobTitle: title,
                jobCompany: company,
                jobLocation: loc,
                url: link,
                scrapedAt: new Date().toISOString()
            });
        }
    }

    return jobs;
}
