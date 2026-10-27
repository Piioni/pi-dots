# Gotgenes permission migration
Objective: preserve permission protections while switching to pinned Gotgenes 41.0.0. Branch: feat/gotgenes-permissions; baseline: dca9b1398f857e3f88bd41c17d73bc47cbf69423.
Delivery: single-pr (user selected), forecast >400 authored lines including probes and tracking, no publishing. Runner: package-supported deterministic probes and isolated Pi startup, selected after inspecting 41.0.0.

## Specs
S1. "Recomiendo probar @gotgenes/pi-permission-system@41.0.0 fijado a esa versión, primero en un entorno de prueba y conservando el clon para poder volver atrás."
S2. "Mantener el permiso general allow." "Mantener ask para git push, git reset --hard, git clean, git worktree remove, rm, kill, pkill y las operaciones gh pr/gh release que ya aparecen en la política." "Mantener deny para sudo y las rutas sensibles." "Verificar reglas por agente o por proyecto que no estén en la política global." User correction: "dale pues corrigelo, que todo lo que tenia en ask, se mantenga en ask"
S3. "La traducción iría al campo unificado permission. Las denegaciones de secretos deberían convertirse en reglas transversales path, para cubrir herramientas de archivos y accesos desde Bash; el clon actual no aplica esas reglas de ruta a comandos como cat." "Las reglas de directorios externos irían en external_directory."
S4. "debug: false → debugLog: false" "yoloMode: false → yoloMode: false" "forwardedPromptTimeoutSeconds: 30 → forwardingTimeoutMs: 30000" "permissionReviewLog: true, explícito para conservar el registro de decisiones que hace el clon." "Antes de reemplazar ese archivo, guardar copias recuperables de config.json y pi-permissions.jsonc. No borrar el clon local."
S5. "Instalar el paquete en el ámbito global y fijar la versión:" `pi install npm:@gotgenes/pi-permission-system@41.0.0` "En el mismo cambio, quitar de settings.json la ruta absoluta al clon local." "Verificar con pi list y el arranque que solo esté activa la versión de Gotgenes."
S6. "En una sesión controlada, sin ejecutar operaciones reales de Linear, Git remoto ni comandos destructivos, verificar:" "allow para operaciones ordinarias y ask para las operaciones acordadas." "deny para secretos mediante read, búsqueda, herramientas de extensión y Bash —incluyendo alias por symlink— y también que YOLO no anule esas denegaciones." "Comportamiento de rutas externas, skills y herramientas MCP." "Registro de decisiones, modo YOLO y timeout de aprobación de subagentes." "Que no haya errores de validación de configuración ni comandos duplicados."
S7. "Si falla una prueba: quitar el paquete Gotgenes, restaurar la ruta del clon en settings.json y recuperar las copias de configuración." "Conservaría el clon y las copias hasta completar una prueba de uso satisfactoria."
S8. Linear decision selected by the user: "Lecturas allow; toda modificación ask (recomendado)". Accepted preview: "**allow:** get_*, list_*, search_documentation, extract_images." "**ask:** save_*, create_*, delete_*, prepare_*upload, update_diff, resolve_diff_thread, submit_diff_review, merge_diff, share_issue, unshare_issue, mark_notification y retiro/restauración de etiquetas." "Incluye comentarios, adjuntos, delegaciones y cambios de estado."

## Tasks
T1 [S2,S8] done; route: delegated read-only explorer mvpdoizn-1-xdu3 and parent spot check; commit: n/a (read-only inventory); evidence: policy/config/settings confirmed, workspace agents have no observed permission overrides; external projects unknown.
T2 [S8] done; route: inline human decision; commit: n/a (human decision); evidence: ask_user_question selected recommended Linear policy.
T3 [S1-S4,S6,S8] blocked; route: delegated correction (runtime context backstop); commit: none; evidence: scoped ask correction is verified (T7); overall prior partial proof remains open. Waits for human decision on remaining serving-parent approval/cancellation integration proof before global cutover; project overrides also untested.
T4 [S4,S5,S7] pending; route: delegated worker (runtime context backstop); commit: pending; outcome: apply verified candidate and pinned package, preserve clone, document exact rollback, verify unique registration/startup.
T5 [S1-S8] pending; route: independent gentle-ai-verify (Risk: item 2, permission/security migration); commit: pending; outcome: assess actual diff, independent isolated checks, parent spot check, reviewable commits and final reconciliation.
T6 [S2,S6] done; route: inline human decision; commit: n/a (human decision); evidence: user explicitly requested "dale pues corrigelo, que todo lo que tenia en ask, se mantenga en ask"; authorize bounded ask-preservation correction, not acceptance of the incompatible candidate.
T7 [S2,S8] done; route: delegated worker mvqdxnhk-2-c9gg plus independent verifier mvqe5wog-3-dsdz; commit: 128929055de07642dc4a028db0470c9df6b1ffd5; evidence: worker RED/GREEN, parent primary probe and independent primary/legacy probes all pass; all 20 Bash forms ask, original sudo/path denies retained. Ask correction complete, not full migration.
T8 [S6] in_progress; route: inline human decision on missing proof; commit: none; outcome: choose whether to scope remaining parent-forwarding integration proof or retain active clone and leave global migration pending; no silent acceptance of unverified behavior.

## Log
L1. User original request verbatim:

Plan de migración a Gotgenes

 Recomiendo probar @gotgenes/pi-permission-system@41.0.0 fijado a esa versión, primero en un entorno de prueba y conservando el clon para poder volver atrás. Pi 1.4.0 y
 Node 22.23.1 cumplen los mínimos declarados por el paquete.

 ### 1. Cerrar el inventario de permisos

 Antes de escribir la configuración, registrar las reglas que queremos preservar:

 - Mantener el permiso general allow.
 - Mantener ask para git push, git reset --hard, git clean, git worktree remove, rm, kill, pkill y las operaciones gh pr/gh release que ya aparecen en la política.
 - Mantener deny para sudo y las rutas sensibles.
 - Verificar reglas por agente o por proyecto que no estén en la política global.

 Decisión pendiente: la política vigente tiene mcp: {}; no especifica qué acciones de Linear deben pedir aprobación, aunque ese comportamiento figuraba como objetivo
 previo. Antes de configurar Gotgenes, hay que inventariar las herramientas de Linear y acordar cuáles van con ask.

 ### 2. Traducir la política, no copiarla tal cual

 Gotgenes detecta pi-permissions.jsonc, pero no traduce sus claves antiguas (defaultPolicy, tools, bash, etc.). Si se deja sin migrar, advierte que existe una política
 vieja, pero esas reglas no pasan a la política nueva.

 La traducción iría al campo unificado permission. Las denegaciones de secretos deberían convertirse en reglas transversales path, para cubrir herramientas de archivos y
 accesos desde Bash; el clon actual no aplica esas reglas de ruta a comandos como cat. Las reglas de directorios externos irían en external_directory.

 ### 3. Reconciliar la configuración compartida

 Gotgenes usa el mismo archivo global que hoy usa el clon: ~/.pi/agent/extensions/pi-permission-system/config.json. Su esquema estricto rechazaría varias claves actuales.
 La conversión propuesta es:

 - debug: false → debugLog: false
 - yoloMode: false → yoloMode: false
 - forwardedPromptTimeoutSeconds: 30 → forwardingTimeoutMs: 30000
 - permissionReviewLog: true, explícito para conservar el registro de decisiones que hace el clon.
 - enabled: true no tiene equivalente en ese esquema; la activación se controla al registrar o quitar el paquete en Pi.

 Antes de reemplazar ese archivo, guardar copias recuperables de config.json y pi-permissions.jsonc. No borrar el clon local.

 ### 4. Cambiar el registro sin cargar ambas extensiones

 Instalar el paquete en el ámbito global y fijar la versión:

╭  sh ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── Copy ╮
│   pi install npm:@gotgenes/pi-permission-system@41.0.0                                                                                                                  │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

 En el mismo cambio, quitar de settings.json la ruta absoluta al clon local. Verificar con pi list y el arranque que solo esté activa la versión de Gotgenes. La
 documentación oficial de Pi permite fijar paquetes npm por versión y recomienda revisar los paquetes porque ejecutan código dentro del proceso de Pi.

 ### 5. Probar antes de dar la migración por buena

 En una sesión controlada, sin ejecutar operaciones reales de Linear, Git remoto ni comandos destructivos, verificar:

 - allow para operaciones ordinarias y ask para las operaciones acordadas.
 - deny para secretos mediante read, búsqueda, herramientas de extensión y Bash —incluyendo alias por symlink— y también que YOLO no anule esas denegaciones.
 - Comportamiento de rutas externas, skills y herramientas MCP.
 - Registro de decisiones, modo YOLO y timeout de aprobación de subagentes.
 - Que no haya errores de validación de configuración ni comandos duplicados.

 ### 6. Rollback

 Si falla una prueba: quitar el paquete Gotgenes, restaurar la ruta del clon en settings.json y recuperar las copias de configuración. Conservaría el clon y las copias
 hasta completar una prueba de uso satisfactoria.

 Estado: este es un plan; no cambié archivos ni instalé el paquete. El siguiente paso es resolver qué herramientas de Linear deben pedir aprobación y después ejecutar la
 migración con estos controles.

vamos a implementar esta migracion

L2. User follow-up: "Review the delivered subagent output and continue."
L3. User selected "Lecturas allow; toda modificación ask (recomendado)" with the preview quoted in S8.
L4. Parent spot-check confirmed explorer inventory against actual files. Pi 1.4.0 and Node v22.23.1 observed. Created feature branch from existing feat/claude-project-adaptation without touching unrelated dirty files. Root .gitignore, Claude adapter files and other existing changes are outside scope. odd/ is already ignored; use force-add only intended tracking/probe/docs artifacts at commit time, not backup/sandbox data.
L5. Risk: item 2 (permission/security enforcement) and item 5 (extension installation). All test data must be synthetic. Workspace is /home/piioni/.pi/agent; no reads/writes targeting external projects or actual credentials. Use ignored odd/ sandbox state inside workspace, not arbitrary paths outside workspace. Parent has read official Pi README, docs/index.md, docs/packages.md and docs/settings.md. Workers must read further relevant official docs fully before implementation.
L6. T3 worker requested sandbox runtime dependencies. Inspected exact 41.0.0 manifest: tree-sitter-bash, web-tree-sitter and zod; source-only entry and no shipped test suite. Parent will install production dependencies only, with scripts disabled and peer auto-installation suppressed, cache inside workspace. Incident check: settings.json already differs from HEAD only in lastChangelogVersion 1.0.4 -> 1.4.0; the initial parent read before migration showed 1.4.0. This is pre-existing runtime state, not worker drift; preserve it and do not attribute it to migration. Policy/config have no baseline diff.
L7. Worker returned partial because its dependency query timed out, not because an acceptance check failed. Backups match all three active files and have mode 600; archive extraction passed path-safety check. Parent job-2 installed five sandbox dependency packages in 9s, exit 0, with lifecycle scripts/dev/automatic peers suppressed. Resume same worker on T3; no global cutover is authorized until acceptance evidence exists.
L8. Incident reported by worker/user: "I accidentally created one symlink outside the allowed edit surface: `odd/gotgenes-permission-system-41.0.0.tgz` (targeting the installed pi-tui directory) due to a malformed `ln` destination. I will not modify/remove it because that would further alter out-of-scope state. Please preserve/inspect and decide cleanup; this is my mistake." Parent paused worker mutations and confirmed with lstat/readlink: the path is a symlink (mode 0777) whose exact target is /home/piioni/.pi/agent/install/releases/1.4.0/node_modules/@earendil-works/pi-tui. Cleanup is limited to unlinking this confirmed accidental symlink; target must remain unchanged. This metadata preserves the link for recovery. Cleanup completed: lstat asserted symlink type and readlink asserted exact target, then os.unlink removed only the link; target device/inode/mtime unchanged and link absence asserted. Worker paused without further mutations. Candidate policy/config now exist and dependency-backed Jiti import succeeded; public probes and cutover/rollback docs remain pending.
L9. Worker T3 continuation returned partial: public-hook candidate and legacy differential passed; forwarding timeout behavior and actual Pi loader/registration uniqueness unverified. Parent reran node odd/gotgenes-permissions/acceptance/probe.mjs once, exit 0, but review found two unrequested candidate policy changes: mcp wildcard ask affects non-Linear servers; later linear:*label* ask can override Linear label reads. One bounded correction must reproduce both with public tests, retain default allow for other MCP servers, place Linear fallback ask before read allows, complete isolated startup/forwarding proof, and remove duplicate candidate policy artifact if redundant. No global cutover until proof resolves. Current reviewable artifact forecast exceeds ~400 authored lines (479 including duplicated policy before active-file migration); choose delivery strategy before next commit, not by shrinking useful tests.
L10. User selected "Una única PR (menos recomendable)" for the oversized delivery question. This sets delivery_strategy=single-pr; chain strategy is inapplicable. Preserve coherent work-unit commits and report reviewer workload. No push, PR creation, or merge is authorized by this selection.
L11. User resume request verbatim: "se corto, continua". Recovery read Engram context, project/feature search, observation 2563 and actual feature file; file and mirror agree. Failed worker result reports only "assistant reported an error", not a functional check verdict. Current branch/HEAD remain feat/gotgenes-permissions / dca9b1398f857e3f88bd41c17d73bc47cbf69423. Active-file diff remains solely pre-existing settings changelog. Existing acceptance directory now contains probe.mjs, legacy-differential.mjs, startup-probe.mjs, forwarding-probe.mjs and codemode-probe.mjs; their final results must be observed. Accidental symlink remains absent. Rebuilt stale visible todo from feature state; continue same bounded T3 correction, not a new sweep or global cutover.
L12. Plan reconciliation: T1/T2 are complete; T3 remains in progress in resumed worker mvqdhvqo-1-tg05, not complete merely because probe files exist. Parent structural check compared SHA-256 of each CURRENT settings.json, pi-permissions.jsonc and clone config.json against its backup: all identical; backup modes all 600. T4 depends on completed T3 proof; T5 independent verification/commits remain pending. No active configuration change or cutover observed.
L13. Final worker mvqdhvqo-1-tg05 returned status partial / T4 readiness no. Reported passing syntax, candidate permission, legacy differential, isolated Pi loader (one permission-system command using exclusion -extensions/pi-permission-system/index.ts), forwarding timeout (300ms fixture, observed 553ms, zero callback executions; deployed timeout remains 30000), and actual host codemode synthetic mutation rejection. It explicitly did not prove serving-parent approval/cancellation or project override behavior. Parent read current candidate/legacy-differential/procedure: candidate contains ten explicit bare risky-command deny entries, whereas legacy-differential only records hook block/allow without an approving UI, so its result does not establish deny-vs-ask equivalence. S2 requests ask, not added permanent denials. Keep T3 partial/blocked and T4/T5 pending; bounded correction exhausted, no extra verification cycle or cutover. T6 asks the human for a concrete scoped decision. User reminder: "The todo plan has not been reviewed during several tool-use turns. Check whether it still matches the work performed and update tasks where needed. Do not mark work done without verification."
L14. User clarification asked whether library supports allow/ask/deny; parent confirmed all three from shipped configuration docs and explained blocked no-UI ask is not permanent deny. User correction verbatim: "dale pues corrigelo, que todo lo que tenia en ask, se mantenga en ask". Update only S2 and reopen T3 with newly explicit bounded correction; T6 decision is complete, but implementation/proof are not. Preserve all ten existing Bash ask rules including bare and argument-bearing forms, plus previous Linear decision; do not modify active config as part of candidate correction. User's repeated todo reminder reviewed: inventory and Linear decisions stay done, T3 becomes in_progress, T4/T5 remain pending, T6 becomes done solely on observed human authorization.
L15. Scoped ask-preservation correction returned ready: removed ten exact bare-command deny entries; wildcard asks unchanged. Legacy decision manager confirms ask (not deny) for all ten bare commands, separately from no-UI rejection. Parent read candidate/probe/differential and ran node odd/gotgenes-permissions/acceptance/probe.mjs, exit 0: all ten bare and ten argument-bearing forms ask; YOLO turns asks to allow but retains sudo/path denials; zero callbacks for rejected asks. Active files still reported matching backups. Direct gentle_review assess with security escalation item 2 returned risk high / nativeRisk unassessable (undeclared untracked files), RDD off, and requires writer self-verification plus one independent verifier; do not retry assessment or start native review. The initial assess call through codemode was rejected as direct-call-only and was corrected to a direct tool call; probe preceding it completed successfully. T7 isolates this requested correction from the still-partial whole migration; no global cutover, install or commit performed.
L16. Independent verifier mvqe5wog-3-dsdz passed scoped S2/S8 correction: primary probe exit 0 confirms 10 bare + 10 argument-bearing ask decisions; legacy differential exit 0 directly confirms legacy bare ask semantics. No global writes. Parent committed only four candidate/probe/docs files as 128929055de07642dc4a028db0470c9df6b1ffd5, 355 authored lines; backup/sandbox files excluded. Parent then verified all three active files SHA-256-identical to backups, modes 600. First review slice is dca9b1398f857e3f88bd41c17d73bc47cbf69423..128929055de07642dc4a028db0470c9df6b1ffd5; inherited unrelated branch history is outside this feature scope. Delivery remains single-pr; no publication. T7 done on observed checks, T3 remains blocked by explicitly missing integration proof, T4/T5 pending. No further verification retries under the exhausted earlier whole-migration correction; expose one Needs your decision result for remaining proof instead of calling the migration complete.
