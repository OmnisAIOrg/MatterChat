# Boards Forms/intake builder (auto/boards-forms-builder) — BUILT, needs runtime verification

STATUS 2026-07-01: all server + client + harness code from the blueprint below is IMPLEMENTED
on this branch. Packages typecheck/build clean (core-typings, model-typings, models,
rest-typings, ui-contexts); app-side forms files show zero TS errors (remaining tsc noise is
pre-existing unbuilt-workspace-package resolution in the fresh worktree, e.g. @rocket.chat/logger).

REMAINING (integration lane):
1. `yarn turbo run build --filter=@rocket.chat/rest-typings --filter=@rocket.chat/core-typings`
   in the running checkout (dist gotcha) + bounce the dev server.
2. Run `scripts/boards-api-test.mjs` — 15 new forms cases appended at the end.
3. Browser-check /boards/board/:id (new "Forms" header button) → forms manager, and /form/:slug
   logged-out (public fill page).
4. After verification: move Forms out of roadmap in docs/current-status.md + FEATURES entry
   (standing document-every-feature rule).

Original blueprint (all executed) follows.

---
name: matterchat-boards-forms-blueprint
description: RESCUED full build blueprint for Boards Forms/intake builder (auto/boards-forms-builder) — implement then DELETE this memory
metadata: 
  node_type: memory
  type: project
  originSessionId: dbb8eb3a-34af-4601-9854-e4c0efe08fef
---

Rescued from session scratchpad 2026-07-01 when the classifier outage blocked all worktree writes. Copy this into /Users/davidnguyen/MatterChat-forms/WIP-NOTES.md, commit+push on `auto/boards-forms-builder`, implement, then delete this memory. See [[matterchat-2026-07-01-session-state]].

## 1. Survey result (feature does NOT exist — safe to build)
- No forms feature on origin/staging: no boards.forms.* endpoints, no IBoardForm, no BoardsForms model, no client surface. docs/current-status.md lists "Forms (intake → card)" as roadmap; docs/design/Omnis-Boards-Parity-BYO-AI-CHI.md P0.7/I2 marks it MISSING.
- Leads/intake pipeline (LeadCaptureModal, boards-leads.*) is a DIFFERENT feature (CasePro lead intake) — do not touch.
- Public-token precedent: apps/meteor/server/lib/boards/ical-token.ts + boards.cards.ical.public in apps/meteor/app/api/server/v1/boards.ts (~line 495): authRequired:false, Random.secret() 43-char token, unknown token → same rejection (no probing).

## 2. Data model
packages/core-typings/src/IBoardForm.ts (new; export from index.ts after ISavedView line 45):
- BoardFormFieldType = 'text'|'textarea'|'select'|'date'|'checkbox'|'email'|'phone'
- IBoardFormField { id (Random.id()), label, type, required?, options? (select), placeholder? }
- IBoardForm extends IRocketChatRecord { boardId, targetListId, title, description?, fields[], titleTemplate? ('{{fieldId}}' placeholders, fallback '<form title> submission'), enabled, slug (Random.secret(), 43 chars), submissionCount, lastSubmissionAt?, archived, rev, createdBy, createdAt }

## 3. Files to create/edit (patterns verified — copy the BoardsSavedViews stack)
1. packages/core-typings/src/IBoardForm.ts + export in src/index.ts.
2. packages/model-typings/src/models/IBoardsFormsModel.ts (mirror IBoardsSavedViewsModel): findByBoard, findById, findOneActiveBySlug (archived:{$ne:true}; enabled checked in service), updateForm ($set + $inc rev), softDelete, recordSubmission ($inc submissionCount, $set lastSubmissionAt). Export in packages/model-typings/src/index.ts ~104.
3. packages/models/src/models/BoardsForms.ts — BoardsFormsRaw extends BaseRaw<IBoardForm>, collection 'boards_forms', same collectionNameResolver identity trick. Indexes: {slug:1} unique, {boardId:1, archived:1}. Register in modelClasses.ts (~19) + index.ts ~242 proxify + type import ~103.
4. apps/meteor/server/models.ts — import BoardsFormsRaw (~25) + registerModel (~132).
5. packages/rest-typings/src/v1/boards-forms.ts (mirror boards-views.ts): isBoardsFormsCreateProps (body: boardId, targetListId, title, description?, fields ≤50 of {id?, label, type enum, required?, options?≤50, placeholder?} additionalProperties:false, titleTemplate?, enabled?); isBoardsFormsUpdateProps (formId + patch); isBoardsFormsListProps (ajvQuery {boardId}); isBoardsFormsDeleteProps {formId}; isBoardsFormsPublicGetProps (ajvQuery {slug minLength 20}); isBoardsFormsPublicSubmitProps {slug, answers:{type:'object'}}. PublicBoardFormDTO = {title; description?; fields} — ONLY thing public GET returns. Endpoints: /v1/boards.forms.create|update|delete POST, .list GET, .public.get GET, .public.submit POST. Wire rest-typings src/index.ts: import ~17, union ~106, export * ~284.
6. apps/meteor/server/lib/boards/forms/service.ts: createForm (assertBoardRole 'member'; list belongs to board + not archived; normalize fields: id ?? Random.id(), trim, dup-id reject, select needs ≥1 option; slug Random.secret()); updateForm (load → assertBoardRole on form.boardId); deleteForm (soft); listForms (getBoardForUser; includes slug); getPublicFormBySlug (null if unknown/archived/!enabled — identical outcome); submitPublicForm: strict validation (unknown keys reject, required, checkbox=boolean, select ∈ options, email/phone loose regex, date YYYY-MM-DD, caps 4000/8000), title from titleTemplate (cap 200), description = ordered '**Label:** value' lines + footer, create card AS form.createdBy via existing createCard() from ../service, then recordSubmission. Returns {ok:true} only.
7. apps/meteor/app/api/server/v1/boards-forms.ts (mirror boards-views.ts API file). Public routes authRequired:false + rateLimiterOptions {60/60000} get, {10/60000} submit. Unknown/disabled → API.v1.notFound() (verify helper; else 400 error-form-not-found). Import in apps/meteor/app/api/server/index.ts ~19.
8. Client: forms/FormsManager.tsx via new `case 'forms':` in BoardRouter.tsx renderBody (props board, lists) → /boards/board/:id/forms. useEndpoint + useQuery ['boards','forms',boardId]; editor: title, description, target-list Select (SelectOption tuples per NewBoardModal), titleTemplate, field rows (label/type/required/options-csv, up/down/remove); enable toggle; Copy link `${origin}/form/${slug}`; delete. i18n t(key,{defaultValue}). forms/BoardFormsButton.tsx (copy automation/BoardAutomationsButton.tsx) → BoardHeader.tsx ButtonGroup. forms/PublicBoardFormPage.tsx public fill page; register /form/:slug in client/startup/routes.tsx (IRouterPaths + defineRoutes appLayout.wrap WITHOUT MainLayout, like /invite/:hash). Plain fetch to /api/v1/boards.forms.public.get?slug=…, native HTML inputs, POST submit, success state. useRouteParameter('slug').
9. Harness scripts/boards-api-test.mjs — append before summary (reuse boardId/listId): create form → slug ≥40 chars; list shows it; public.get NO auth returns title+fields, asserts boardId/targetListId ABSENT; public.submit valid → 200 + new card w/ templated title + '**Name:**' in description; missing required → 400; unknown key → 400; bad select → 400; update enabled:false → public.get+submit 404; bad slug 404; delete → list empty.
10. Docs: update docs/current-status.md (move Forms out of roadmap) once verified.

## 4. Security decisions (locked)
Slug Random.secret() ≈256 bits, unique index; disabled==unknown==archived (identical 404). Public GET returns only title/description/fields; submit returns only {ok:true}. rateLimiterOptions on public routes (submit 10/min). Strict server-side answer validation (unknown keys rejected). Card created as form.createdBy through normal createCard path (ACL/activity/events preserved).

## 5. Next steps (in order)
1. Write files 1–7 server stack, 8 client, 9 harness. 2. yarn turbo run build --filter=@rocket.chat/rest-typings --filter=@rocket.chat/core-typings (dist gotcha) + bounce dev server before harness verification. 3. Run harness; browser-check /boards/board/:id/forms + /form/:slug. 4. node_modules NOT installed in the worktree.
