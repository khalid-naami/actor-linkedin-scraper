# 💼 LinkedIn Ultimate Scraper & B2B Lead Generator (Profiles, Leads, Companies & Jobs)

Comprehensive, high-speed, all-in-one LinkedIn data extraction and B2B lead generation engine on Apify. Extract **People Profiles & Leads** (with verified emails, phone numbers, headlines, experience, and education), **Company Profiles & Firmographics**, **Job Postings**, and **Public Job Searches** with No-Cookie and Cookie modes.

---

## ⚡ Key Features

- 👤 **People Profiles & Talent Sourcing**: Extract Full Name, Headline, Current Position & Company, Experience History, Education History, Skills, Location, Summary / About, and Profile Picture.
- 📧 **B2B Lead Generation & Contact Enrichment**: Automatically extracts business emails, contact phone numbers, portfolios, and social media handles (Twitter/X, GitHub, personal websites).
- 🏢 **Company Intelligence & Firmographics**: Extract Company Name, Industry sector, Employee Size range, Headquarters location, Official Website, Tagline, Logo, and About description.
- 🎯 **Job Vacancies & Descriptions**: Extract Job Title, Hiring Organization, Location, Workplace type (`Remote`, `Hybrid`, `On-site`), Employment type (`Full-time`), Full job description, and Apply links.
- 🔍 **Public Jobs Search (Zero Cookies Needed)**: Search LinkedIn jobs by keywords and location without needing any LinkedIn account or cookies.
- 🛡️ **Dual-Engine Architecture & Anti-Wall**: Blazing fast HTTP requests via `got-scraping` paired with an intelligent Playwright browser fallback and optional `li_at` session cookie support.

---

## 📥 Input Configuration

| Parameter | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `mode` | String | `AUTO_DETECT` | Extraction mode: `AUTO_DETECT`, `PROFILES`, `COMPANIES`, `JOBS`, `JOBS_SEARCH`. |
| `targetUrls` | Array | `[...]` | LinkedIn URLs (Profile URLs `/in/...`, Company URLs `/company/...`, or Job URLs). |
| `searchKeywords` | Array | `[]` | Keywords or Job Titles for public jobs search. |
| `searchLocation` | String | `"United States"` | Location filter for public jobs search (e.g., `United States`, `Remote`, `London`). |
| `maxItems` | Integer | `30` | Maximum items to extract per run. |
| `liAtCookie` | String | `""` | Optional LinkedIn `li_at` session cookie for deep private profile data. |
| `proxyConfiguration` | Object | `{ useApifyProxy: true }` | Apify Residential proxy configuration (strongly recommended). |

---

## 📤 Output Data Format

### 1. Person Profile & B2B Lead Record

```json
{
  "type": "PROFILE",
  "id": "satyanadella",
  "url": "https://www.linkedin.com/in/satyanadella/",
  "fullName": "Satya Nadella",
  "firstName": "Satya",
  "lastName": "Nadella",
  "headline": "Chairman and CEO at Microsoft",
  "currentCompany": "Microsoft",
  "location": "Redmond, Washington, United States",
  "about": "Chairman and CEO of Microsoft Corporation...",
  "education": [
    { "school": "The University of Chicago Booth School of Business", "degree": "MBA" }
  ],
  "profilePictureUrl": "https://media.licdn.com/dms/image/...",
  "email": "satya@microsoft.com",
  "emails": ["satya@microsoft.com"],
  "socialLinks": [
    { "platform": "twitter_x", "url": "https://x.com/satyanadella" }
  ],
  "scrapedAt": "2026-10-09T12:55:00.000Z"
}
```

### 2. Company Profile Record

```json
{
  "type": "COMPANY",
  "id": "microsoft",
  "url": "https://www.linkedin.com/company/microsoft/",
  "companyName": "Microsoft",
  "companyIndustry": "Software Development",
  "companySize": "10,001+ employees",
  "companyWebsite": "https://www.microsoft.com",
  "companyHq": "Redmond, WA, United States",
  "about": "Our mission is to empower every person and every organization on the planet to achieve more.",
  "profilePictureUrl": "https://media.licdn.com/dms/image/...",
  "scrapedAt": "2026-10-09T12:55:00.000Z"
}
```

### 3. Job Vacancy Record

```json
{
  "type": "JOB",
  "id": "3950123456",
  "url": "https://www.linkedin.com/jobs/view/3950123456",
  "jobTitle": "Senior Full Stack Engineer",
  "jobCompany": "TechCorp Innovations",
  "jobLocation": "San Francisco, CA, United States",
  "jobWorkplaceType": "Remote",
  "jobEmploymentType": "FULL_TIME",
  "jobDescription": "We are seeking an experienced full-stack engineer proficient in Node.js, React, and cloud architectures...",
  "datePosted": "2026-10-08T14:30:00.000Z",
  "scrapedAt": "2026-10-09T12:55:00.000Z"
}
```

---

## 💼 B2B Sales & Recruitment Use Cases

- **Cold Email & Outbound Sales**: Enrich your prospect lists with verified names, current roles, and emails.
- **Talent Acquisition & Recruiting**: Source top engineering, product, and leadership talent with full career history.
- **Market & Competitor Research**: Track competitor employee growth, new hires, and job vacancy trends.

---

## 📄 License
Apache-2.0
