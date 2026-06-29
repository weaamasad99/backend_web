# Comprehension Scoring (Phase B) — Implementation Plan

Spec: docs/superpowers/specs/2026-06-28-chat-analyzer-comprehension-design.md
Branch: feature/comprehension-scoring (both repos)
Execution: inline, per-task test + commit.

## Global constraints
- Judge uses the **chat** Gemini client (`chatAI` / `CHAT_KEY`). No new npm packages. English comments.
- Judge failure must NOT block the chat reply or the upload; prior Progress retained.
- score→level: `<40 low · <65 medium · <85 high · >=85 excellent`.
- Endpoints JWT-protected (`protect`). `/progress/student/:id` lecturer-only.

## Task 1 — scoring service (backend)
Files: `src/services/comprehensionService.js` (new), `test/comprehension.test.js` (new).
- `scoreToLevel(score) -> 'low'|'medium'|'high'|'excellent'` (pure; clamps 0-100).
- `assessComprehension(keywords, contextExcerpts, conversation) -> { score, level, rationale }`
  using `chatAI.models.generateContent` with JSON responseSchema (mirror `extractPaperMetadata`).
  Conversation = array of {role:'user'|'model', text}. On any error throw (caller handles).
- Tests (node --test): scoreToLevel boundaries (39→low,40→medium,64→medium,65→high,84→high,85→excellent, -5→low, 200→excellent).
- Commit.

## Task 2 — progress controller + routes (backend)
Files: `src/controllers/progressController.js` (new), `src/routes/progressRoutes.js` (new), `src/app.js` (mount), `test/comprehension.test.js` (extend).
- `upsertProgress(studentId, paperId, score)` helper → Progress.findOneAndUpdate({student,paper},{score,understandingLevel:scoreToLevel(score)},{upsert,new,setDefaultsOnInsert}). Export for reuse.
- `getMyProgress(req,res)` → Progress.find({student: currentUser._id}) → array `{paper, score, understandingLevel}`.
- `getStudentProgress(req,res)` → lecturer-only (req user role==='lecturer' else 401) → Progress.find({student: :id}).
- routes: GET '/me' protect getMyProgress; GET '/student/:id' protect getStudentProgress.
- app.js: `app.use('/api/progress', require('./routes/progressRoutes'));`
- Commit.

## Task 3 — chatController hook (backend)
File: `src/controllers/chatController.js` (`sendMessage`).
- After bot reply saved + chat.save(): build conversation from chat.messages; call assessComprehension(chat.paper.keywords, chat.paper.content-derived excerpts, conversation); upsertProgress(chat.student, chat.paper._id, score). Wrap in try/catch (log, don't block). 
- Return `{ ...chat.toObject(), progress: { score, understandingLevel } }` (or include latest Progress). Keep existing chat shape; add `progress` field.
- Manual note: verified by E2E.
- Commit.

## Task 4 — frontend progressService + ChatAnalyzer bar
Files: `Cloud-project/src/app/services/progressService.ts` (new), `components/analysis/ChatAnalyzer.tsx`.
- progressService: `getMyProgress(): Promise<ProgressItem[]>` (GET /progress/me), `getStudentProgress(id)`; `ProgressItem = {paper:string, score:number, understandingLevel:string}`.
- ChatAnalyzer: add state `progressByPaper: Record<string, number>`. On chat load fetch getMyProgress → map. Replace `comprehensionPercent = messages.length*12` with `progressByPaper[activeArticleId] ?? 0`. On sendChatMessage response, if `progress` present, update progressByPaper[activeArticleId].
- tsc check. Commit.

## Task 5 — frontend ChatInterface panel wiring
File: `Cloud-project/src/app/components/chat/ChatInterface.tsx`.
- Replace the heuristic `perArticleComprehension` (line ~363) with real data: fetch getMyProgress (own) or getStudentProgress(viewedId) → Record<paperId, score>. Keep fallback to 0.
- tsc check. Commit.

## Verify (E2E, manual — needs login)
Chat as student → ask questions → bar moves with real score; lecturer view → panel shows real per-paper comprehension.
