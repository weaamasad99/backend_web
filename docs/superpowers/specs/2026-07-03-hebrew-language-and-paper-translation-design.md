# Design: Hebrew UI language + paper translation (ResearchAI)

## 1. Goal

Two related features:

1. **System language switch (English ⇄ Hebrew)** for the app's *core chrome*
   (side nav, top bar, settings screen), with a switcher in the top bar and in
   the settings screen. When Hebrew is active, the whole layout flips to RTL.
2. **On-demand Hebrew translation of a paper's readable text** (title, abstract,
   methodology, key findings) when a paper is opened for reading, via Gemini,
   with a per-paper DB cache.

Out of scope (deliberate): translating every string on every screen (Dashboard,
Library, Chat, History, Reports keep English text for now — but their layout
still flips to RTL); translating the embedded raw PDF inside its iframe (not
feasible in-place).

## 2. Scope decisions (agreed with user)

| Decision | Choice |
|----------|--------|
| UI translation depth | Core chrome only (nav, top bar, settings). Expandable later. |
| Paper translation target | Structured text the app renders (title, abstract, methodology, keyFindings). |
| Layout direction | Full RTL (`dir="rtl"`) when Hebrew is active. |
| Translation Gemini key | The additional key (`ingestAI` / `ADDITIONAL_API_KEY`), to keep live-chat quota free. |
| Auto-translate default | When UI language is Hebrew, the paper-translation toggle defaults ON. |

## 3. Architecture — Part 1: UI language + RTL

### 3.1 LanguageContext

New `src/app/context/LanguageContext.tsx`, mirroring the existing
`ThemeContext` pattern (localStorage-backed, `useEffect` to apply side effects).

- State: `language: 'en' | 'he'` (default `'en'`), persisted under localStorage
  key `language`.
- Exposes: `{ language, setLanguage, t }`.
- `t(key: string): string` — looks up `translations[language][key]`, falls back
  to `translations.en[key]`, and finally to the key itself if missing.
- `useEffect([language])`:
  - `localStorage.setItem('language', language)`
  - `document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr'`
  - `document.documentElement.lang = language`
- `useLanguage()` hook with the same "must be used within provider" guard as
  `useTheme()`.

Mounted in `src/app/App.tsx` **inside** `ThemeProvider`:
`<ThemeProvider><LanguageProvider>…</LanguageProvider></ThemeProvider>`.

### 3.2 Translation dictionary

New `src/app/i18n/translations.ts`:

```ts
export const translations = {
  en: { 'nav.chat': 'Research Chat', 'settings.title': 'Settings', /* … */ },
  he: { 'nav.chat': 'צ׳אט מחקר',      'settings.title': 'הגדרות',   /* … */ },
} as const;
```

Keys cover **core chrome only**:
- Nav items (6): `nav.chat`, `nav.chatAnalyzer`, `nav.library`, `nav.reports`,
  `nav.history`, `nav.settings`.
- Top bar: `topbar.guide`.
- Settings: section labels + descriptions, field labels (Full Name,
  Institution, Research Field, Font Family, Default Citation Format, Default
  Analysis Depth, Appearance, Language), and buttons (Save Changes, Save
  Preferences, Back to Home), plus Dark/Light/Fast/Regular/Deep labels.
- Language switcher label(s).

### 3.3 Wiring the switcher

- **Top bar** ([MainLayout.tsx]): a small globe-icon button next to the theme
  toggle; click flips `language` between `'en'`/`'he'`. Shows current target
  (e.g. "עב" / "EN").
- **Settings → Preferences** ([SettingsPage.tsx]): a "Language / שפה" row with
  two buttons (English / עברית), styled like the existing Appearance (theme)
  buttons, calling `setLanguage`.
- **nav.ts**: labels become translation keys; `Sidebar` renders `t(item.key)`.
  (nav.ts currently exports literal labels — change to keys + keep icons/paths.)
- MainLayout and SettingsPage swap their hardcoded core-chrome strings for
  `t('…')`.

## 4. Architecture — Part 2: Paper translation

### 4.1 Backend

**`geminiService.translateToHebrew(fields)`**
- Input: `{ title, abstract, methodology, keyFindings: string[] }`.
- One Gemini call via the **`ingestAI`** client (the additional key), JSON mode,
  returning the same shape translated to Hebrew. Reuses `generateWithRetry`.
- Guard: if `!INGEST_KEY` throw a clean configured-key error.
- Empty/`'Unknown'`/`[]` fields pass through untranslated (skip in prompt).
- On parse/model failure: throw a clean `Error('Failed to translate paper')`.

**Paper model** ([Paper.js]): add
```js
translations: { type: Object, default: {} } // { he: { title, abstract, methodology, keyFindings, translatedAt } }
```

**Controller** `getPaperTranslation` in `paperController.js`:
- `GET /papers/:id/translation?lang=he` (only `he` supported for now; other →
  400).
- Load paper. If `paper.translations?.he` exists → return it (cache hit).
- Else call `translateToHebrew`, save under `paper.translations.he` with
  `translatedAt`, return it. Wrapped in try/catch → clean 500 message.

**Route** in `paperRoutes.js`: `router.get('/:id/translation', protect, getPaperTranslation)`
(mirrors existing protected paper routes).

### 4.2 Frontend

**`paperService.getPaperTranslation(id, lang='he')`** → `GET /papers/:id/translation`,
returns `{ title, abstract, methodology, keyFindings }`.

**ArticleDetail.tsx**:
- New state: `translated` (fetched Hebrew fields or null), `showTranslated`
  (bool), `translating` (loading).
- A toggle button in the header next to Export/Share: "תרגם לעברית" ⇄
  "הצג מקור". First activation fetches (spinner on the button); result cached in
  `translated` so subsequent toggles are instant.
- When `showTranslated`, render title/abstract/methodology/keyFindings from
  `translated`, with `dir="rtl"` on those text blocks.
- **Default**: if `useLanguage().language === 'he'`, initialize `showTranslated`
  to `true` (auto-fetch on mount).

## 5. Error handling

- Translation fetch failure → `toast.error` + revert `showTranslated` to false,
  keep original English text visible.
- All new Gemini/Mongo calls wrapped in try/catch returning clean client
  messages (matches existing controller/service conventions).
- Missing UI translation key → falls back to English, never crashes.

## 6. Testing

- **Backend (pure logic):** unit-test the translation prompt/field-filter helper
  (which fields are skipped when empty/'Unknown') without hitting Gemini.
- **Manual verification:**
  - Toggle language in top bar and settings → nav/top bar/settings switch to
    Hebrew, layout flips to RTL, choice persists across reload.
  - Open a paper, toggle "תרגם לעברית" → structured text renders in Hebrew RTL;
    re-open the same paper → served from DB cache (no second Gemini call).
  - With UI language = Hebrew, opening a paper auto-shows the Hebrew translation.
  - Translation failure path → toast + original text remains.

## 7. Files touched

**Frontend (Cloud-project):**
- `src/app/context/LanguageContext.tsx` (new)
- `src/app/i18n/translations.ts` (new)
- `src/app/App.tsx` (wrap with LanguageProvider)
- `src/app/config/nav.ts` (labels → keys)
- `src/app/components/layout/Sidebar.tsx` (render `t(key)`)
- `src/app/components/layout/MainLayout.tsx` (top-bar switcher + `t`)
- `src/app/components/settings/SettingsPage.tsx` (language control + `t`)
- `src/app/services/paperService.ts` (`getPaperTranslation`)
- `src/app/components/library/ArticleDetail.tsx` (translate toggle)

**Backend (backend_web):**
- `src/services/geminiService.js` (`translateToHebrew`)
- `src/models/Paper.js` (`translations` field)
- `src/controllers/paperController.js` (`getPaperTranslation`)
- `src/routes/paperRoutes.js` (route)
