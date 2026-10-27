/**
 * Read-only web surface for the Academic Review panel.
 *
 * Three GET routes under /plugins/dsh-academic-review/reviews, authenticated by
 * the host connection gate (same wrapper the AgentTeams plugin uses). No POST,
 * no mutation: the only bytes ever read live under
 * <workspace>/<stateDir>/<review_id>/, and review ids are validated against a
 * strict character class so a crafted URL cannot traverse out of the review
 * root.
 *
 *   GET .../reviews            -> { reviews: ReviewSummary[] }
 *   GET .../reviews/<id>       -> ReviewSummary (404 when unknown)
 *   GET .../reviews/<id>/report -> { markdown } (409 { error } when not written yet)
 *
 * @module dsh-academic-review/web
 */
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { SEAT_IDS, SEVERITIES, validateReviewState, } from "./state.js";
/** Route prefix shared by every panel data route. */
export const REVIEWS_ROUTE_ROOT = '/plugins/dsh-academic-review/reviews';
/** Web-server service keys, newest first (mirrors the AgentTeams plugin). */
const WEB_SERVER_KEYS = ['webServer', 'httpServer'];
/** Review ids are tool-generated: rev-YYYYMMDD-8hex. Nothing else is addressed. */
const REVIEW_ID_RE = /^rev-[0-9]{8}-[0-9a-f]{8}$/;
/** Empty severity tally in canonical order. */
function emptySeverityTally() {
    return { critical: 0, major: 0, minor: 0, comment: 0 };
}
/** Whether the record is waiting on one of the two human checkpoints. */
function isPendingCheckpoint(state) {
    return state.status === 'awaiting_panel_confirmation' || state.status === 'awaiting_synthesis_approval';
}
/** Collapse one review record to the panel summary. */
export function summarizeReview(state) {
    const seats = state.panel.seats.map(seat => {
        const tally = emptySeverityTally();
        let open = 0;
        if (seat.report !== null) {
            for (const finding of seat.report.findings) {
                if (SEVERITIES.includes(finding.severity)) {
                    tally[finding.severity] += 1;
                }
                open += 1;
            }
        }
        return {
            seat_id: seat.seat_id,
            status: seat.status,
            findings_open: open,
            findings_by_severity: tally,
        };
    });
    return {
        review_id: state.review_id,
        paper_name: basename(state.paper.path),
        mode: state.mode,
        status: state.status,
        seats,
        updated_at: state.updated_at,
        pending_checkpoint: isPendingCheckpoint(state),
    };
}
/** Build the store configuration for the configured workspace. */
function storeConfig(config) {
    return {
        workspace: resolve(config.workspaceRoot && config.workspaceRoot.trim() !== '' ? config.workspaceRoot : process.cwd()),
        stateDir: config.stateDir,
    };
}
/** Write a JSON response with the shared no-store headers. */
function respondJson(res, status, body) {
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
}
/** Reject non-GET methods on the read-only surface. */
function rejectNonGet(req, res) {
    if (req.method === 'GET' || req.method === 'HEAD')
        return false;
    res.writeHead(405, { allow: 'GET, HEAD', 'cache-control': 'no-store' });
    res.end();
    return true;
}
/**
 * Register the three read-only review routes on the host web server.
 *
 * Registration is deferred until the webServer (or legacy httpServer) service
 * appears, matching the AgentTeams assembly pattern; a headless composition
 * that never provides one simply never routes.
 *
 * @param ctx - plugin context.
 * @param config - state-dir/workspace configuration shared with the tools.
 */
export function registerAcademicReviewWebRoutes(ctx, config) {
    let registered = false;
    const register = () => {
        if (registered)
            return;
        const rawWebServer = (ctx.get(WEB_SERVER_KEYS[0]) ?? ctx.get(WEB_SERVER_KEYS[1]));
        if (rawWebServer === undefined)
            return;
        // Build the state root directly: reviewDirOf validates a single review id
        // and this is the (empty) root itself.
        const store = storeConfig(config);
        const root = resolve(join(store.workspace, store.stateDir ?? '.academic-review'));
        const reviewRoot = root.endsWith(sep) ? root : root + sep;
        /** Read + validate one review's state, or null when absent/invalid. */
        const readState = async (reviewId) => {
            if (!REVIEW_ID_RE.test(reviewId))
                return null;
            let raw;
            try {
                raw = await readFile(join(reviewRoot, reviewId, 'state.json'), 'utf8');
            }
            catch {
                return null;
            }
            try {
                return validateReviewState(JSON.parse(raw.replace(/^\uFEFF/, '')), reviewId);
            }
            catch {
                return null;
            }
        };
        const webServer = {
            register(route) {
                const gate = () => ctx.get('connection');
                return rawWebServer.register({
                    ...route,
                    async handler(req, res) {
                        const connection = gate();
                        const rejection = connection === undefined ? 503 : await connection.requestRejection(req);
                        if (rejection !== undefined && rejection !== 0) {
                            respondJson(res, rejection, { error: rejection === 503 ? 'authentication unavailable'
                                    : rejection === 401 ? 'unauthorized' : 'forbidden' });
                            return;
                        }
                        await route.handler(req, res);
                    },
                });
            },
        };
        registered = true;
        // GET /reviews - every review under the state root, newest first.
        ctx.effect(() => webServer.register({
            kind: 'exact',
            path: REVIEWS_ROUTE_ROOT,
            handler: async (req, res) => {
                if (rejectNonGet(req, res))
                    return;
                let ids = [];
                try {
                    ids = (await readdir(reviewRoot, { withFileTypes: true }))
                        .filter(entry => entry.isDirectory() && REVIEW_ID_RE.test(entry.name))
                        .map(entry => entry.name);
                }
                catch {
                    ids = [];
                }
                const reviews = [];
                for (const id of ids) {
                    const state = await readState(id);
                    if (state !== null)
                        reviews.push(summarizeReview(state));
                }
                reviews.sort((a, b) => a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0);
                respondJson(res, 200, { reviews });
            },
        }), 'academic-review: reviews list route');
        // GET /reviews/<id> and GET /reviews/<id>/report - one prefix route that
        // dispatches on the subpath. The host matches prefixes with
        // `pathname !== prefix && !pathname.startsWith(prefix + '/')`, so the
        // prefix must NOT carry a trailing slash: a trailing slash would only ever
        // match '.../reviews/' itself and 404 every detail request on a real host.
        ctx.effect(() => webServer.register({
            kind: 'prefix',
            path: REVIEWS_ROUTE_ROOT,
            handler: async (req, res) => {
                if (rejectNonGet(req, res))
                    return;
                const url = new URL(req.url ?? '/', 'http://localhost');
                // Exactly REVIEWS_ROUTE_ROOT matches the list dispatch below; anything
                // longer must start '<root>/' to be a detail path. The trailing-slash
                // strip tolerates a single cosmetic slash after the id.
                const pathname = url.pathname;
                if (pathname !== REVIEWS_ROUTE_ROOT && !pathname.startsWith(REVIEWS_ROUTE_ROOT + '/')) {
                    respondJson(res, 404, { error: 'not_found' });
                    return;
                }
                const rest = pathname === REVIEWS_ROUTE_ROOT ? '' : pathname.slice(REVIEWS_ROUTE_ROOT.length + 1).replace(/\/+$/, '');
                const slash = rest.indexOf('/');
                const reviewId = slash === -1 ? rest : rest.slice(0, slash);
                const tail = slash === -1 ? '' : rest.slice(slash + 1);
                if (!REVIEW_ID_RE.test(reviewId) || (tail !== '' && tail !== 'report')) {
                    respondJson(res, 404, { error: 'not_found' });
                    return;
                }
                const state = await readState(reviewId);
                if (state === null) {
                    respondJson(res, 404, { error: 'review_not_found' });
                    return;
                }
                if (tail === '') {
                    respondJson(res, 200, summarizeReview(state));
                    return;
                }
                // Report route: only the letter written by the synthesizer is exposed;
                // the path comes from the record itself but is re-anchored under the
                // review directory (state validation guarantees a relative name, and
                // resolve + prefix check makes the guarantee physical).
                const letterRelative = state.synthesis.decision_letter_path;
                const letterPath = resolve(reviewRoot, reviewId, letterRelative);
                if (!letterPath.startsWith(resolve(reviewRoot, reviewId) + sep)) {
                    respondJson(res, 409, { error: 'report_not_ready' });
                    return;
                }
                let markdown;
                try {
                    markdown = await readFile(letterPath, 'utf8');
                }
                catch {
                    respondJson(res, 409, { error: 'report_not_ready' });
                    return;
                }
                respondJson(res, 200, { markdown });
            },
        }), 'academic-review: review detail routes');
    };
    register();
    ctx.on('internal/service', (name) => {
        if (WEB_SERVER_KEYS.includes(name) || name === 'connection')
            register();
    });
}
/** Seat ids exported for the panel contract test. */
export { SEAT_IDS };
