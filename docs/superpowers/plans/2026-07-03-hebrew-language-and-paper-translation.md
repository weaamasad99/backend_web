# Hebrew UI Language + Paper Translation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an English⇄Hebrew system-language switch (core chrome + full RTL) and an on-demand Hebrew translation of a paper's readable text when it's opened for reading.

**Architecture:** A React `LanguageContext` (mirroring the existing `ThemeContext`) holds the language, persists it to localStorage, and flips `document.documentElement.dir` to `rtl`. Core-chrome strings resolve through a `t(key)` dictionary. Paper translation is a backend Gemini call (on the additional/ingest key) cached per-paper in Mongo, exposed via `GET /papers/:id/translation` and driven by a toggle in the reader.

**Tech Stack:** React 18 + TypeScript + Vite (frontend, `Cloud-project/`); Node/Express + Mongoose + `@google/genai` (backend, `backend_web/`).

## Global Constraints

- Backend Gemini keys are server-side only; never exposed to the client. (spec §3, existing code)
- Paper translation uses the **`ingestAI`** client (`ADDITIONAL_API_KEY` → falls back to `GEMINI_API_KEY`), to keep interactive-chat quota free. (spec §2)
- UI translation scope is **core chrome only**: side nav, top bar, settings screen. Other screens keep English text but still flip to RTL. (spec §2)
- All new Gemini/Mongo calls wrapped in try/catch returning clean client messages; missing values fall back to originals. (spec §5)
- Follow existing patterns: localStorage-backed context like `ThemeContext`; JSON-mode Gemini calls like `extractPaperMetadata`; protected routes via `protect`. (existing code)
- Comments in English.

---

## Task 1: Backend — `translateToHebrew` service function

**Files:**
- Modify: `backend_web/src/services/geminiService.js` (add helper + function, extend exports at EOF)
- Test: `backend_web/src/services/geminiService.filterFields.test.js` (new)

**Interfaces:**
- Produces: `filterTranslatableFields(fields) -> { title?, abstract?, methodology?, keyFindings? }` and
  `translateToHebrew(fields) -> Promise<{ title, abstract, methodology, keyFindings }>`, both exported from `geminiService`.

- [ ] **Step 1: Write the failing test**

Create `backend_web/src/services/geminiService.filterFields.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { filterTranslatableFields } = require('./geminiService');

test('drops empty, placeholder, and empty-array fields', () => {
  const out = filterTranslatableFields({
    title: 'Deep Learning',
    abstract: '   ',
    methodology: 'Unknown',
    keyFindings: [],
  });
  assert.deepStrictEqual(out, { title: 'Deep Learning' });
});

test('keeps real values and non-empty findings, trims strings', () => {
  const out = filterTranslatableFields({
    title: '  A Study  ',
    abstract: 'We measured X.',
    methodology: 'Unknown methodology',
    keyFindings: ['Finding one', '  ', 'Finding two'],
  });
  assert.deepStrictEqual(out, {
    title: 'A Study',
    abstract: 'We measured X.',
    keyFindings: ['Finding one', 'Finding two'],
  });
});

test('returns empty object when nothing is translatable', () => {
  assert.deepStrictEqual(
    filterTranslatableFields({ title: '', methodology: 'Unknown', keyFindings: [] }),
    {}
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend_web && node --test src/services/geminiService.filterFields.test.js`
Expected: FAIL — `filterTranslatableFields is not a function` (not yet exported).

- [ ] **Step 3: Add the pure helper**

In `backend_web/src/services/geminiService.js`, immediately after the `generateWithRetry` definition (after its closing `};`, around line 35), add:

```js
// Values that carry no meaning aren't worth a translation round-trip.
const PLACEHOLDER_VALUES = new Set(['', 'Unknown', 'Unknown methodology']);

/**
 * Pick only the paper fields worth translating. Empty strings, placeholder
 * values, and empty arrays are dropped so we don't ask Gemini to translate
 * "Unknown". Strings are trimmed.
 * @param {{title?:string, abstract?:string, methodology?:string, keyFindings?:string[]}} fields
 * @returns {{title?:string, abstract?:string, methodology?:string, keyFindings?:string[]}}
 */
const filterTranslatableFields = (fields = {}) => {
  const out = {};
  for (const key of ['title', 'abstract', 'methodology']) {
    const val = (fields[key] || '').trim();
    if (val && !PLACEHOLDER_VALUES.has(val)) out[key] = val;
  }
  const findings = Array.isArray(fields.keyFindings)
    ? fields.keyFindings.map((f) => (f || '').trim()).filter(Boolean)
    : [];
  if (findings.length > 0) out.keyFindings = findings;
  return out;
};
```

- [ ] **Step 4: Add `translateToHebrew`**

In the same file, immediately after `filterTranslatableFields`, add:

```js
/**
 * Translate a paper's readable metadata into Hebrew via Gemini JSON mode.
 * Runs on the ingest client (additional key) to keep chat quota free.
 * Untranslatable/empty fields fall back to their originals.
 * @param {{title?:string, abstract?:string, methodology?:string, keyFindings?:string[]}} fields
 * @returns {Promise<{title:string, abstract:string, methodology:string, keyFindings:string[]}>}
 */
const translateToHebrew = async (fields = {}) => {
  if (!INGEST_KEY) throw new Error('Gemini API key is not configured.');

  const original = {
    title: fields.title || '',
    abstract: fields.abstract || '',
    methodology: fields.methodology || '',
    keyFindings: Array.isArray(fields.keyFindings) ? fields.keyFindings : [],
  };

  const translatable = filterTranslatableFields(fields);
  if (Object.keys(translatable).length === 0) return original;

  try {
    const response = await generateWithRetry(ingestAI, {
      model: MODEL,
      contents: `Translate the JSON values of this academic paper metadata into Hebrew.
Keep the JSON keys and structure identical. Translate naturally and academically.
Keep technical acronyms and named entities (e.g. CNN, RNN, p-value, BERT) as-is where a Hebrew term would be unclear.

${JSON.stringify(translatable)}`,
      config: {
        systemInstruction: 'You are an academic translator. Translate English paper metadata into fluent academic Hebrew, preserving meaning.',
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            abstract: { type: 'STRING' },
            methodology: { type: 'STRING' },
            keyFindings: { type: 'ARRAY', items: { type: 'STRING' } },
          },
        },
      },
    });

    const parsed = JSON.parse(response.text);
    return {
      title: parsed.title || original.title,
      abstract: parsed.abstract || original.abstract,
      methodology: parsed.methodology || original.methodology,
      keyFindings:
        Array.isArray(parsed.keyFindings) && parsed.keyFindings.length
          ? parsed.keyFindings
          : original.keyFindings,
    };
  } catch (error) {
    console.error('Gemini Translation Error:', error);
    throw new Error('Failed to translate paper');
  }
};
```

- [ ] **Step 5: Export the new functions**

In `backend_web/src/services/geminiService.js`, find the `module.exports` block and add the two functions. It currently exports `generateSocraticResponse`, `extractPaperMetadata`, `assessComprehension` (and possibly others). Add:

```js
  filterTranslatableFields,
  translateToHebrew,
```

- [ ] **Step 6: Run tests + module load**

Run: `cd backend_web && node --test src/services/geminiService.filterFields.test.js`
Expected: PASS (3 tests).
Run: `cd backend_web && node -e "require('dotenv').config(); require('./src/services/geminiService'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 7: Commit**

```bash
cd backend_web
git add src/services/geminiService.js src/services/geminiService.filterFields.test.js 2>/dev/null || true
git commit -m "feat: add translateToHebrew Gemini service on the ingest key" 2>/dev/null || echo "no git repo — skipping commit"
```

> Note: the working tree is **not** a git repo. If `git commit` fails, that's expected — the code change is what matters.

---

## Task 2: Backend — translation cache field, controller, and route

**Files:**
- Modify: `backend_web/src/models/Paper.js` (add `translations` field)
- Modify: `backend_web/src/controllers/paperController.js` (import + `getPaperTranslation` + export)
- Modify: `backend_web/src/routes/paperRoutes.js` (import + route)

**Interfaces:**
- Consumes: `translateToHebrew` from Task 1.
- Produces: `GET /api/papers/:id/translation?lang=he` → `{ title, abstract, methodology, keyFindings, translatedAt }`.

- [ ] **Step 1: Add the cache field to the Paper model**

In `backend_web/src/models/Paper.js`, inside the schema object, after the `suggestionsUpdatedAt` field (around line 63) add:

```js
    // Cached translations of the paper's readable text, keyed by language code.
    // Shape: { he: { title, abstract, methodology, keyFindings, translatedAt } }
    translations: {
      type: Object,
      default: {},
    },
```

- [ ] **Step 2: Import `translateToHebrew` in the controller**

In `backend_web/src/controllers/paperController.js`, change line 3 from:

```js
const { generateSocraticResponse, extractPaperMetadata } = require('../services/geminiService');
```

to:

```js
const { generateSocraticResponse, extractPaperMetadata, translateToHebrew } = require('../services/geminiService');
```

- [ ] **Step 3: Add the `getPaperTranslation` controller**

In `backend_web/src/controllers/paperController.js`, immediately before the `module.exports = {` block (around line 305), add:

```js
// @desc    Get (and cache) a Hebrew translation of a paper's readable text
// @route   GET /api/papers/:id/translation?lang=he
// @access  Private
const getPaperTranslation = async (req, res, next) => {
  try {
    const lang = req.query.lang || 'he';
    if (lang !== 'he') {
      return res.status(400).json({ message: 'Only Hebrew (he) translation is supported.' });
    }

    const paper = await Paper.findById(req.params.id);
    if (!paper) {
      return res.status(404).json({ message: 'Paper not found' });
    }

    // Cache hit — return the stored translation, no Gemini call.
    if (paper.translations && paper.translations.he) {
      return res.json(paper.translations.he);
    }

    const translated = await translateToHebrew({
      title: paper.title,
      abstract: paper.abstract,
      methodology: paper.methodology,
      keyFindings: paper.keyFindings,
    });

    const stored = { ...translated, translatedAt: new Date() };
    paper.translations = { ...(paper.translations || {}), he: stored };
    paper.markModified('translations'); // Mixed/Object type — tell Mongoose it changed.
    await paper.save();

    res.json(stored);
  } catch (error) {
    next(error);
  }
};
```

- [ ] **Step 4: Export the controller**

In the `module.exports = {` block at the end of `paperController.js`, add a line:

```js
  getPaperTranslation,
```

- [ ] **Step 5: Register the route**

In `backend_web/src/routes/paperRoutes.js`, update the controller import on line 6 to include `getPaperTranslation`:

```js
const { getPapers, getPaperById, uploadPaper, deletePaper, queryPaper, getPaperSuggestions, getSuggestionsForPapers, ingestPaperById, getPaperTranslation } = require('../controllers/paperController');
```

Then add this route after the `/:id/query` route (around line 27):

```js
// Hebrew translation of the paper's readable text (cached in the Paper doc).
router.get('/:id/translation', protect, getPaperTranslation);
```

- [ ] **Step 6: Verify the server boots**

Run: `cd backend_web && node -e "require('dotenv').config(); require('./src/routes/paperRoutes'); console.log('routes ok')"`
Expected: prints `routes ok` with no import errors.

- [ ] **Step 7: Manual endpoint check (optional, needs a real paper id + token)**

With the backend running, hit `GET http://localhost:5001/api/papers/<id>/translation?lang=he` with a valid `Authorization: Bearer <token>` header. Expected: JSON with Hebrew `title`/`abstract`/`methodology`/`keyFindings` and a `translatedAt`. Second call for the same id returns instantly (cache hit).

- [ ] **Step 8: Commit**

```bash
cd backend_web
git add src/models/Paper.js src/controllers/paperController.js src/routes/paperRoutes.js 2>/dev/null || true
git commit -m "feat: add cached Hebrew paper-translation endpoint" 2>/dev/null || echo "no git repo — skipping commit"
```

---

## Task 3: Frontend — `LanguageContext` + translation dictionary + provider

**Files:**
- Create: `Cloud-project/src/app/i18n/translations.ts`
- Create: `Cloud-project/src/app/context/LanguageContext.tsx`
- Modify: `Cloud-project/src/app/App.tsx`

**Interfaces:**
- Produces: `useLanguage() -> { language: 'en'|'he', setLanguage(l), t(key: string): string }`, and `<LanguageProvider>`.
- Produces: `translations` object with `en`/`he` keyed by dotted string keys.

- [ ] **Step 1: Create the translation dictionary**

Create `Cloud-project/src/app/i18n/translations.ts`:

```ts
// Core-chrome UI strings only (side nav, top bar, settings). Other screens
// keep English text for now but still flip to RTL when Hebrew is active.
export const translations: Record<'en' | 'he', Record<string, string>> = {
  en: {
    'nav.chat': 'Research Chat',
    'nav.chatAnalyzer': 'Chat Analyzer',
    'nav.library': 'All Articles',
    'nav.reports': 'Analyzed Reports',
    'nav.history': 'Chat History',
    'nav.settings': 'Settings',
    'topbar.guide': 'Guide',
    'settings.title': 'Settings',
    'settings.subtitle': 'Manage your account and preferences',
    'settings.backHome': 'Back to Home',
    'settings.section.profile': 'Profile',
    'settings.section.profile.desc': 'Name, institution',
    'settings.section.preferences': 'Preferences',
    'settings.section.preferences.desc': 'Analysis defaults, citation format',
    'settings.section.notifications': 'Notifications',
    'settings.section.notifications.desc': 'Alerts, digests, reminders',
    'settings.section.privacy': 'Privacy',
    'settings.section.privacy.desc': 'Data sharing, export, deletion',
    'settings.fullName': 'Full Name',
    'settings.institution': 'Institution',
    'settings.researchField': 'Research Field',
    'settings.saveChanges': 'Save Changes',
    'settings.fontFamily': 'Font Family',
    'settings.citationFormat': 'Default Citation Format',
    'settings.analysisDepth': 'Default Analysis Depth',
    'settings.depth.fast': 'Fast',
    'settings.depth.regular': 'Regular',
    'settings.depth.deep': 'Deep',
    'settings.appearance': 'Appearance',
    'settings.theme.dark': 'Dark',
    'settings.theme.light': 'Light',
    'settings.language': 'Language',
    'settings.savePreferences': 'Save Preferences',
    'reader.translate': 'Translate to Hebrew',
    'reader.showOriginal': 'Show original',
    'reader.translating': 'Translating…',
  },
  he: {
    'nav.chat': 'צ׳אט מחקר',
    'nav.chatAnalyzer': 'מנתח שיחות',
    'nav.library': 'כל המאמרים',
    'nav.reports': 'דוחות מנותחים',
    'nav.history': 'היסטוריית שיחות',
    'nav.settings': 'הגדרות',
    'topbar.guide': 'מדריך',
    'settings.title': 'הגדרות',
    'settings.subtitle': 'ניהול החשבון וההעדפות',
    'settings.backHome': 'חזרה לדף הבית',
    'settings.section.profile': 'פרופיל',
    'settings.section.profile.desc': 'שם, מוסד',
    'settings.section.preferences': 'העדפות',
    'settings.section.preferences.desc': 'ברירות מחדל לניתוח, פורמט ציטוט',
    'settings.section.notifications': 'התראות',
    'settings.section.notifications.desc': 'התראות, תקצירים, תזכורות',
    'settings.section.privacy': 'פרטיות',
    'settings.section.privacy.desc': 'שיתוף נתונים, ייצוא, מחיקה',
    'settings.fullName': 'שם מלא',
    'settings.institution': 'מוסד',
    'settings.researchField': 'תחום מחקר',
    'settings.saveChanges': 'שמור שינויים',
    'settings.fontFamily': 'גופן',
    'settings.citationFormat': 'פורמט ציטוט ברירת מחדל',
    'settings.analysisDepth': 'עומק ניתוח ברירת מחדל',
    'settings.depth.fast': 'מהיר',
    'settings.depth.regular': 'רגיל',
    'settings.depth.deep': 'מעמיק',
    'settings.appearance': 'מראה',
    'settings.theme.dark': 'כהה',
    'settings.theme.light': 'בהיר',
    'settings.language': 'שפה',
    'settings.savePreferences': 'שמור העדפות',
    'reader.translate': 'תרגם לעברית',
    'reader.showOriginal': 'הצג מקור',
    'reader.translating': 'מתרגם…',
  },
};
```

- [ ] **Step 2: Create the LanguageContext**

Create `Cloud-project/src/app/context/LanguageContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { translations } from '../i18n/translations';

type Language = 'en' | 'he';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');

  useEffect(() => {
    const saved = localStorage.getItem('language') as Language | null;
    if (saved === 'en' || saved === 'he') setLanguage(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem('language', language);
    document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
  }, [language]);

  const t = (key: string): string =>
    translations[language][key] ?? translations.en[key] ?? key;

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
```

- [ ] **Step 3: Wrap the app**

Replace the contents of `Cloud-project/src/app/App.tsx` with:

```tsx
import { RouterProvider } from 'react-router';
import { router } from './routes';
import { ThemeProvider } from './context/ThemeContext';
import { LanguageProvider } from './context/LanguageContext';

export default function App() {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <RouterProvider router={router} />
      </LanguageProvider>
    </ThemeProvider>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd Cloud-project && npx tsc --noEmit`
Expected: no errors from the three new/edited files. (Pre-existing unrelated errors, if any, are out of scope — confirm none reference `LanguageContext`, `translations`, or `App.tsx`.)

- [ ] **Step 5: Commit**

```bash
cd "Cloud-project"
git add src/app/i18n/translations.ts src/app/context/LanguageContext.tsx src/app/App.tsx 2>/dev/null || true
git commit -m "feat: add LanguageContext, i18n dictionary, RTL switching" 2>/dev/null || echo "no git repo — skipping commit"
```

---

## Task 4: Frontend — nav keys, Sidebar labels, top-bar language switcher

**Files:**
- Modify: `Cloud-project/src/app/config/nav.ts`
- Modify: `Cloud-project/src/app/components/layout/Sidebar.tsx`
- Modify: `Cloud-project/src/app/components/layout/MainLayout.tsx`

**Interfaces:**
- Consumes: `useLanguage()` from Task 3.
- Produces: `NAV_ITEMS` entries now expose `labelKey` (translation key) alongside `path`/`icon`.

- [ ] **Step 1: Convert nav items to translation keys**

Replace the contents of `Cloud-project/src/app/config/nav.ts` with:

```ts
import { MessageSquare, Activity, BookOpen, BarChart, History, Settings } from 'lucide-react';

// labelKey resolves through the i18n dictionary (see i18n/translations.ts).
export const NAV_ITEMS = [
  { icon: MessageSquare, labelKey: 'nav.chat',         path: '/' },
  { icon: Activity,      labelKey: 'nav.chatAnalyzer', path: '/chat-analyzer' },
  { icon: BookOpen,      labelKey: 'nav.library',      path: '/library' },
  { icon: BarChart,      labelKey: 'nav.reports',      path: '/reports' },
  { icon: History,       labelKey: 'nav.history',      path: '/history' },
  { icon: Settings,      labelKey: 'nav.settings',     path: '/settings' },
];
```

> If `npx tsc --noEmit` later flags a removed `CHAT_LABEL` import elsewhere, add `export const CHAT_LABEL = 'Research Chat';` back to this file. (Grep `CHAT_LABEL` first — Step 4 covers this.)

- [ ] **Step 2: Render translated labels in the Sidebar**

In `Cloud-project/src/app/components/layout/Sidebar.tsx`:

Add the hook import after the existing imports (after line 7):

```tsx
import { useLanguage } from '../../context/LanguageContext';
```

Inside the `Sidebar` component body, after `const { user, logout } = useAuth();` (line 18), add:

```tsx
  const { t } = useLanguage();
```

`SidebarContent` is defined inside `Sidebar`, so it closes over `t`. Now replace the three references to `item.label` with `t(item.labelKey)`:
- line 66 `key={item.label}` → `key={item.path}`
- line 68 `title={(!forMobile && collapsed) ? item.label : undefined}` → `title={(!forMobile && collapsed) ? t(item.labelKey) : undefined}`
- line 81 `<span ...>{item.label}</span>` → `<span ...>{t(item.labelKey)}</span>`

- [ ] **Step 3: Add the language switcher + translate the top bar**

In `Cloud-project/src/app/components/layout/MainLayout.tsx`:

Update the icon import on line 3 to add `Languages`:

```tsx
import { Menu, FileText, Sun, Moon, HelpCircle, Languages } from 'lucide-react';
```

Add the context import after line 6:

```tsx
import { useLanguage } from '../../context/LanguageContext';
```

Inside the component, after `const { theme, setTheme } = useTheme();` (line 11), add:

```tsx
  const { language, setLanguage, t } = useLanguage();
```

Replace the Guide button's label span (line 50) `<span className="hidden sm:inline">Guide</span>` with:

```tsx
              <span className="hidden sm:inline">{t('topbar.guide')}</span>
```

Then add the language toggle button immediately **before** the theme toggle button (before line 52's `<button onClick={() => setTheme(...`):

```tsx
            <button
              onClick={() => setLanguage(language === 'he' ? 'en' : 'he')}
              className="p-2 rounded-lg bg-muted border border-border hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs font-bold"
              title={language === 'he' ? 'Switch to English' : 'החלף לעברית'}
            >
              <Languages className="w-4 h-4" />
              <span>{language === 'he' ? 'EN' : 'עב'}</span>
            </button>
```

- [ ] **Step 4: Check for `CHAT_LABEL` consumers**

Run: `cd Cloud-project && grep -rn "CHAT_LABEL" src`
If any file other than the old `nav.ts` imports it, either restore the export (see Task 4 Step 1 note) or replace that usage with `t('nav.chat')`. If no results, continue.

- [ ] **Step 5: Typecheck**

Run: `cd Cloud-project && npx tsc --noEmit`
Expected: no errors referencing `nav.ts`, `Sidebar.tsx`, or `MainLayout.tsx`.

- [ ] **Step 6: Manual check in the browser**

With the dev server running (http://localhost:5173), click the new עב/EN button in the top bar. Expected: side nav labels + "Guide" switch to Hebrew, the whole layout flips right-to-left, and the choice survives a page reload.

- [ ] **Step 7: Commit**

```bash
cd "Cloud-project"
git add src/app/config/nav.ts src/app/components/layout/Sidebar.tsx src/app/components/layout/MainLayout.tsx 2>/dev/null || true
git commit -m "feat: translate nav + top bar, add language switcher" 2>/dev/null || echo "no git repo — skipping commit"
```

---

## Task 5: Frontend — Settings screen language control + translated labels

**Files:**
- Modify: `Cloud-project/src/app/components/settings/SettingsPage.tsx`

**Interfaces:**
- Consumes: `useLanguage()` from Task 3.

- [ ] **Step 1: Wire the hook and translate the `sections` array**

In `Cloud-project/src/app/components/settings/SettingsPage.tsx`:

Add after the existing context imports (after line 8):

```tsx
import { useLanguage } from '../../context/LanguageContext';
```

The module-level `sections` array (lines 16-21) uses literal labels. Change it to carry keys instead — replace it with:

```tsx
const sections: { id: Section; icon: typeof Settings; labelKey: string; descKey: string }[] = [
  { id: 'profile',       icon: User,    labelKey: 'settings.section.profile',       descKey: 'settings.section.profile.desc' },
  { id: 'preferences',   icon: Palette, labelKey: 'settings.section.preferences',   descKey: 'settings.section.preferences.desc' },
  { id: 'notifications', icon: Bell,    labelKey: 'settings.section.notifications', descKey: 'settings.section.notifications.desc' },
  { id: 'privacy',       icon: Shield,  labelKey: 'settings.section.privacy',       descKey: 'settings.section.privacy.desc' },
];
```

Inside the component, after `const { theme, setTheme } = useTheme();` (line 26), add:

```tsx
  const { language, setLanguage, t } = useLanguage();
```

- [ ] **Step 2: Replace section label/desc renders**

- Desktop nav (lines 121-122): `{s.label}` → `{t(s.labelKey)}` and `{s.desc}` → `{t(s.descKey)}`.
- Mobile picker (line 143): `{s.label}` → `{t(s.labelKey)}`.

- [ ] **Step 3: Translate the header and core labels**

Replace these literal strings with `t(...)` calls:
- Page title `Settings` (line 89) → `{t('settings.title')}`
- Subtitle `Manage your account and preferences` (line 90) → `{t('settings.subtitle')}`
- `Back to Home` (line 98) → `{t('settings.backHome')}`
- Profile `Full Name` (line 177) → `{t('settings.fullName')}`
- Profile `Institution` (line 185) → `{t('settings.institution')}`
- Profile `Research Field` (line 194) → `{t('settings.researchField')}`
- `Save Changes` (line 206) → `{t('settings.saveChanges')}`
- `Font Family` (line 221) → `{t('settings.fontFamily')}`
- `Default Citation Format` (line 229) → `{t('settings.citationFormat')}`
- `Default Analysis Depth` (line 251) → `{t('settings.analysisDepth')}`
- Depth `Fast`/`Regular`/`Deep` (lines 263-265) → `{t('settings.depth.fast')}` / `.regular` / `.deep`
- `Appearance` (line 273) → `{t('settings.appearance')}`
- Theme `Dark` (line 281) → `{t('settings.theme.dark')}`, `Light` (line 289) → `{t('settings.theme.light')}`
- `Save Preferences` (line 298) → `{t('settings.savePreferences')}`
- The Preferences `<h2>` text `Preferences` (line 215) → `{t('settings.section.preferences')}`
- The Profile `<h2>` text `Profile` (line 156) → `{t('settings.section.profile')}`

- [ ] **Step 4: Add the Language control in the Preferences section**

In the Preferences section, immediately **after** the Theme (`Appearance`) block's closing `</div>` (after line 292, before the Save Preferences button on line 294), add:

```tsx
                {/* Language */}
                <div>
                  <label className="block text-sm font-bold text-foreground mb-3">{t('settings.language')}</label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setLanguage('en')}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-bold transition-all active:scale-95 ${
                        language === 'en' ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-2' : 'border-border bg-card text-muted-foreground hover:border-muted hover:bg-muted'
                      }`}
                    >
                      English
                    </button>
                    <button
                      onClick={() => setLanguage('he')}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-bold transition-all active:scale-95 ${
                        language === 'he' ? 'border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-2' : 'border-border bg-card text-muted-foreground hover:border-muted hover:bg-muted'
                      }`}
                    >
                      עברית
                    </button>
                  </div>
                </div>
```

- [ ] **Step 5: Typecheck**

Run: `cd Cloud-project && npx tsc --noEmit`
Expected: no errors referencing `SettingsPage.tsx`.

- [ ] **Step 6: Manual check**

Open http://localhost:5173/settings. Expected: section labels and Preferences/Profile fields render in the current language; the new Language row toggles English/עברית and flips the layout; selecting Hebrew matches the top-bar switch.

- [ ] **Step 7: Commit**

```bash
cd "Cloud-project"
git add src/app/components/settings/SettingsPage.tsx 2>/dev/null || true
git commit -m "feat: translate settings screen + add language control" 2>/dev/null || echo "no git repo — skipping commit"
```

---

## Task 6: Frontend — paper translation service + reader toggle

**Files:**
- Modify: `Cloud-project/src/app/services/paperService.ts` (add `getPaperTranslation`)
- Modify: `Cloud-project/src/app/components/library/ArticleDetail.tsx` (toggle + render)

**Interfaces:**
- Consumes: `GET /papers/:id/translation` (Task 2), `useLanguage()` (Task 3).
- Produces: `getPaperTranslation(id, lang?) -> Promise<PaperTranslation>` where
  `PaperTranslation = { title: string; abstract: string; methodology: string; keyFindings: string[] }`.

- [ ] **Step 1: Add the service function**

In `Cloud-project/src/app/services/paperService.ts`, at the end of the file add:

```ts
export interface PaperTranslation {
  title: string;
  abstract: string;
  methodology: string;
  keyFindings: string[];
}

// Fetch (server-cached) Hebrew translation of a paper's readable text.
export async function getPaperTranslation(id: string, lang: 'he' = 'he'): Promise<PaperTranslation> {
  const response = await api.get(`/papers/${id}/translation`, { params: { lang } });
  const d = response.data;
  return {
    title: d.title || '',
    abstract: d.abstract || '',
    methodology: d.methodology || '',
    keyFindings: Array.isArray(d.keyFindings) ? d.keyFindings : [],
  };
}
```

- [ ] **Step 2: Wire state + hook into ArticleDetail**

In `Cloud-project/src/app/components/library/ArticleDetail.tsx`:

Add imports — extend line 2's lucide import to include `Languages` and `Loader2`, and add the service + hook + toast imports after line 5:

```tsx
import { Languages, Loader2 } from 'lucide-react';
import { getPaperTranslation, PaperTranslation } from '../../services/paperService';
import { useLanguage } from '../../context/LanguageContext';
import { toast } from 'sonner';
```

(Keep the existing `lucide-react` import on line 2; you may instead append `Languages, Loader2` to it. Ensure no duplicate import lines for the same module — merge if the linter/tsc complains.)

Inside the component, after `const [showPDF, setShowPDF] = useState(false);` (line 22), add:

```tsx
  const { language, t } = useLanguage();
  const [translated, setTranslated] = useState<PaperTranslation | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);
  const [translating, setTranslating] = useState(false);
```

- [ ] **Step 3: Add the fetch/toggle handler + Hebrew auto-default**

Immediately after the `handleSendMessage` function (after line 66), add:

```tsx
  const loadTranslation = async () => {
    if (!article) return;
    setTranslating(true);
    try {
      const data = await getPaperTranslation(article.id, 'he');
      setTranslated(data);
      setShowTranslated(true);
    } catch (err) {
      toast.error('Translation failed. Showing the original text.');
      setShowTranslated(false);
    } finally {
      setTranslating(false);
    }
  };

  const toggleTranslation = () => {
    if (showTranslated) {
      setShowTranslated(false); // back to original — instant
    } else if (translated) {
      setShowTranslated(true);  // cached in component — instant
    } else {
      loadTranslation();        // first time — fetch
    }
  };

  // When the whole UI is in Hebrew, default the reader to the translated view.
  useEffect(() => {
    if (language === 'he' && article && !translated && !translating) {
      loadTranslation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, articleId]);
```

Add `useEffect` to the React import on line 1: change `import { useState } from 'react';` to `import { useState, useEffect } from 'react';`.

- [ ] **Step 4: Derive the displayed fields**

After the handlers (before the `return (`), add a view-model that swaps in the translation when active:

```tsx
  const view = showTranslated && translated
    ? { title: translated.title, abstract: translated.abstract, methodology: translated.methodology, keyFindings: translated.keyFindings }
    : { title: article.title, abstract: article.abstract, methodology: article.methodology, keyFindings: article.keyFindings };
  const textDir = showTranslated && translated ? 'rtl' : undefined;
```

- [ ] **Step 5: Add the toggle button + render translated text**

Add the translate button inside the header actions, before the Export button (before line 110 `<button ...><Download .../>Export</button>`):

```tsx
              <button
                onClick={toggleTranslation}
                disabled={translating}
                className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-2 disabled:opacity-60"
              >
                {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
                {translating ? t('reader.translating') : showTranslated ? t('reader.showOriginal') : t('reader.translate')}
              </button>
```

Now swap the rendered fields to use `view` + `textDir`:
- Title (line 83) `{article.title}` → `<span dir={textDir}>{view.title}</span>` (keep the `<h1>` wrapper; or add `dir={textDir}` to the `<h1>`).
- Abstract paragraph (line 133) `{article.abstract}` → wrap: `<p dir={textDir} className="text-sm text-slate-700 leading-relaxed">{view.abstract}</p>` (replace the existing `<p>` opening tag to include `dir={textDir}`).
- Methodology paragraph (line 139) `{article.methodology}` → add `dir={textDir}` to its `<p>` and use `{view.methodology}`.
- Key findings map (line 149) `article.keyFindings.map(...)` → `view.keyFindings.map(...)`, and add `dir={textDir}` to the `<ul>` on line 148.

- [ ] **Step 6: Typecheck**

Run: `cd Cloud-project && npx tsc --noEmit`
Expected: no errors referencing `paperService.ts` or `ArticleDetail.tsx`.

- [ ] **Step 7: Manual end-to-end check**

With both servers running, open an **uploaded** paper's detail page. Click "תרגם לעברית": button shows a spinner, then title/abstract/methodology/key-findings render in Hebrew RTL and the button reads "הצג מקור". Toggle back → original English, instant. Reload and translate again → instant (DB cache hit). Switch the whole UI to Hebrew, then open a paper → it auto-shows the Hebrew translation. (Mock/seed articles without a real DB id will toast a translation failure and keep English — expected.)

- [ ] **Step 8: Commit**

```bash
cd "Cloud-project"
git add src/app/services/paperService.ts src/app/components/library/ArticleDetail.tsx 2>/dev/null || true
git commit -m "feat: add Hebrew paper-translation toggle in the reader" 2>/dev/null || echo "no git repo — skipping commit"
```

---

## Self-Review Notes

- **Spec §3 (LanguageContext + dictionary + RTL):** Tasks 3 (context/dictionary/provider), 4 (nav+top bar), 5 (settings). ✓
- **Spec §3.3 switchers (top bar + settings):** Task 4 Step 3 (top bar), Task 5 Step 4 (settings). ✓
- **Spec §4.1 backend (translateToHebrew on ingest key, cache field, endpoint):** Tasks 1 + 2. ✓
- **Spec §4.2 frontend (service + reader toggle + Hebrew auto-default):** Task 6. ✓
- **Spec §5 error handling:** Task 1 (service try/catch), Task 2 (controller via `next`), Task 6 Step 3 (toast + revert). ✓
- **Spec §6 testing:** Task 1 unit test (pure helper); manual verification steps in Tasks 2/4/5/6. Frontend has no test harness — manual + `tsc` is the realistic gate. ✓
- **Type consistency:** `PaperTranslation` shape identical in service (Task 6.1) and consumed in ArticleDetail (Task 6). `translateToHebrew` return shape (Task 1) matches controller usage (Task 2) and endpoint contract. `labelKey`/`descKey` introduced in nav.ts (Task 4.1) consumed in Sidebar (Task 4.2); `sections[].labelKey/descKey` introduced and consumed within Task 5. ✓
- **Non-git working tree:** every commit step is guarded with `|| echo "no git repo"`. ✓
```