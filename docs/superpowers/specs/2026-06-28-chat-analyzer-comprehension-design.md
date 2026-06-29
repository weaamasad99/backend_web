# Design: Chat Analyzer — real comprehension + selection/chat fixes

Date: 2026-06-28
Status: APPROVED (design). Implementation deferred (token budget). Resume via writing-plans.
Scope: `Cloud-project` (frontend) + `backend_web`.

## Background / current state (verified in code)

- **Chat Analyzer** (`Cloud-project/src/app/components/analysis/ChatAnalyzer.tsx`) already wires the chat to the real backend (`startOrResumeChat` / `sendChatMessage` → `/api/chats` → the RAG pipeline). It is NOT faked.
- **Backend** has an unused `Progress` model (`models/Progress.js`): `{ student, paper, score:Number, understandingLevel: low|medium|high|excellent, lecturerFeedback }`, unique per (student, paper). No progress routes/controller exist yet.
- Lecturer dashboard fetches `/users/students`; `StudentPerformancePanel` expects a `perArticleComprehension: Record<string, number>` prop.

## Phase A — selection + functional chat (DONE 2026-06-28)

Implemented inline (frontend only, tsc clean, Vite HMR verified):
1. **Rehydrate** `analysis_groups_v1` from localStorage on mount, filter stale article ids, seed a default "My Research" group only if none valid. (Fixed the bug where groups were never reloaded → "No articles selected" after reload.)
2. **Empty state** text in the control bar (no papers / no group selected).
3. **Removed** the `demo-comprehension-100` override that stuck the bar at 100%/MAX.

Remaining for Phase A: user to visually confirm the logged-in student flow (Firebase auth can't be driven headless).

## Phase B — real comprehension (#3) — APPROVED, NOT YET IMPLEMENTED

### Decisions (locked with user)
- Measure comprehension via **LLM judge over the conversation** (not heuristic, not quiz).
- Scope: **student bar + lecturer dashboard**, both fed from the real `Progress` data.
- Judge call: **separate lightweight JSON call** after each student message (keeps the Socratic reply natural). Uses the **chat key**. A judge failure must NOT block the chat reply (previous score retained).

### 1. Scoring service (backend)
`geminiService.assessComprehension(keywords, contextExcerpts, conversation) -> { score: 0-100, level, rationale }`
- JSON mode (responseSchema), chat client (`chatAI` / `CHAT_KEY`).
- Prompt: judge how well the student demonstrated understanding of the paper's key concepts (keywords) from their answers in the conversation.
- score→level mapping: `<40 low · <65 medium · <85 high · >=85 excellent` (matches the existing enum).

### 2. Integration point
`chatController.sendMessage`: after the bot reply is generated and saved, run `assessComprehension` over the conversation, then **upsert** `Progress(student = chat.student, paper = chat.paper, score, understandingLevel)`. Include the updated progress in the JSON response so the frontend updates the bar live without a second call. Wrap in try/catch — failure logs and leaves the prior Progress untouched.

### 3. New endpoints (protected) — `progressController` + `progressRoutes`, mounted in `app.js`
- `GET /api/progress/me?paperId=<id>` → the logged-in student's score/level for that paper (bar load / resume).
- `GET /api/progress/student/:id` → for a lecturer: that student's Progress per paper (feeds `StudentPerformancePanel`).

### 4. Frontend
- New `services/progressService.ts`: `getMyProgress(paperId)`, `getStudentProgress(studentId)`.
- **ChatAnalyzer**: replace `comprehensionPercent = messages.length * 12` with the real Progress score for the active paper. On chat load, fetch `/progress/me`; on each `sendChatMessage` response, read the returned progress and update the bar live.
- **Lecturer**: feed `StudentPerformancePanel`'s `perArticleComprehension` from `/progress/student/:id`.

### 5. Tests
- Unit (pure, `node --test`): score→level mapping; Progress upsert (update vs insert). LLM judge itself verified by manual E2E.

### 6. Files touched
- backend: `services/geminiService.js` (+assessComprehension), `controllers/chatController.js` (hook), `controllers/progressController.js` (new), `routes/progressRoutes.js` (new), `app.js` (mount).
- frontend: `components/analysis/ChatAnalyzer.tsx`, `services/progressService.ts` (new), `components/dashboard/LecturerDashboard.tsx` and/or `StudentPerformancePanel.tsx` (wiring).

### Non-goals
- Quiz flow; full score history (latest-per-paper only); changing the Socratic prompt; cross-paper aggregation beyond simple averages.

## Resume instructions
Next session: invoke `superpowers:writing-plans` against this spec (Phase B) to produce a task-by-task implementation plan, then execute (subagent-driven, like the RAG feature). Branch off `main` first (e.g. `feature/comprehension-scoring`).
