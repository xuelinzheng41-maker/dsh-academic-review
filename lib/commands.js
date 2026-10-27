/**
 * Human slash commands for the dsh-academic-review plugin.
 *
 * Two thin commands sit on top of the same state layer the five
 * `academic_review_*` tools use - no transition, schema check, or write path is
 * re-implemented here, so a review opened from `/ars-review` is the same
 * record the model sees through `academic_review_status`:
 *
 * - `/ars-review [quick|full] <path-to-manuscript>` opens a review and prints
 *   the exact `academic_review_confirm` attach call that comes next;
 * - `/ars-review-status [review_id]` reports the newest review (or the named
 *   one) plus the checkpoint or tool call the user is waiting on.
 *
 * Host API, verified rather than guessed: the registration shape is
 * `ctx.commands.register({ name, description, input: { hint }, handler })`
 * from `@deepseek-ai/dsh-commands` (`CommandRuntime.register`, typings
 * `lib/types/index.d.ts` in 0.2.1-rc.1 and the installed 0.2.1-rc.2 runtime in
 * DSH Desktop). `name` must match /^[a-z][a-z0-9_-]*$/u, `handler(invocation)`
 * receives `{ commandId, agent, rawInput, attachments, signal }` and returns
 * `{ kind: 'success', text }` or `{ kind: 'error', text }`. Registering
 * returns a fiber-scoped disposer, so the registry is cleaned up on unload.
 * The service is reached lazily (never a required `inject`), so a headless
 * composition without a command registry still mounts the tools and the skill.
 *
 * Every message is plain text the dispatching UI renders verbatim: a refusal
 * is one actionable line, never a stack trace.
 *
 * @module dsh-academic-review/commands
 */
import { join } from 'node:path';
import { MODES, ReviewError, ReviewStore, SEAT_DEFINITIONS, UNIMPLEMENTED_MODES, workspaceOfAgent, } from "./state.js";
/** Name of the review-creation command (no leading slash). */
export const REVIEW_COMMAND = 'ars-review';
/** Name of the review-status command (no leading slash). */
export const REVIEW_STATUS_COMMAND = 'ars-review-status';
/** Input hint advertised for `/ars-review`. */
export const REVIEW_COMMAND_HINT = '[quick|full] <path-to-manuscript>';
/** Input hint advertised for `/ars-review-status`. */
export const REVIEW_STATUS_COMMAND_HINT = '[review_id]';
/** Refusal raised by the command grammar itself, before any state is touched. */
export class CommandUsageError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CommandUsageError';
    }
}
/** Build the store the tools would build for this workspace. */
function storeFor(agent, config) {
    return new ReviewStore({
        workspace: workspaceOfAgent(agent, config.workspaceRoot),
        stateDir: config.stateDir,
        ...(config.maxPaperBytes === undefined ? {} : { maxPaperBytes: config.maxPaperBytes }),
        ...(config.upstreamSkillVersion === undefined ? {} : { upstreamSkillVersion: config.upstreamSkillVersion }),
        ...(config.upstreamCommit === undefined ? {} : { upstreamCommit: config.upstreamCommit }),
    });
}
/**
 * Flatten any thrown value to one actionable line.
 * @param error - thrown value.
 * @returns a single-line message with no stack trace and no newlines.
 */
export function oneLine(error) {
    const raw = error instanceof Error ? error.message : String(error);
    const flattened = raw.replace(/\s+/gu, ' ').trim();
    return flattened === '' ? 'the command failed without a message' : flattened;
}
/** Collapse one rendered message to the single-line contract. */
function line(parts) {
    return parts.filter(part => part.trim() !== '').join(' ');
}
/** Strip one pair of matching surrounding quotes from a path argument. */
function unquote(value) {
    const text = value.trim();
    if (text.length >= 2) {
        const first = text.charAt(0);
        const last = text.charAt(text.length - 1);
        if ((first === '"' && last === '"') || (first === "'" && last === "'"))
            return text.slice(1, -1).trim();
    }
    return text;
}
/** Usage line shown whenever the create grammar does not parse. */
export function reviewUsage() {
    return 'Usage: /' + REVIEW_COMMAND + ' ' + REVIEW_COMMAND_HINT;
}
/**
 * Parse `[quick|full] <path-to-manuscript>`.
 *
 * The mode token is optional and only recognised as its own first token, so a
 * manuscript literally named "full something.md" still addresses correctly
 * when quoted as a path after a mode.
 *
 * @param rawInput - exact text following the command name.
 * @returns the mode (default full) plus the manuscript path.
 */
export function parseReviewInput(rawInput) {
    const text = rawInput.trim();
    if (text === '')
        throw new CommandUsageError(reviewUsage());
    const split = text.search(/\s/u);
    const head = (split === -1 ? text : text.slice(0, split)).toLowerCase();
    const rest = split === -1 ? '' : text.slice(split + 1).trim();
    if (MODES.includes(head)) {
        const paperPath = unquote(rest);
        if (paperPath === '')
            throw new CommandUsageError(reviewUsage() + ' - the ' + head + ' mode still needs a manuscript path');
        return { mode: head, paperPath };
    }
    if (UNIMPLEMENTED_MODES.includes(head)) {
        throw new CommandUsageError('mode "' + head + '" is not implemented in this Phase 1 port; use '
            + MODES.join('|') + ' (no state was created)');
    }
    return { mode: 'full', paperPath: unquote(text) };
}
/** Render the seat table of one review record. */
function seatLines(state) {
    return state.panel.seats.map(seat => {
        const definition = SEAT_DEFINITIONS[seat.seat_id];
        return '  - ' + seat.seat_id + ' (' + definition.roleMarker + '): ' + definition.roleName + ' - ' + seat.status;
    });
}
/** Render one configuration card placeholder for an attach call. */
function cardPlaceholder(seatId) {
    return '{"seat": "' + seatId + '", "identity": "<...>", "expertise": "<...>", "focus": "<...>"}';
}
/**
 * The exact `academic_review_confirm` attach call for one review.
 * @param state - freshly created record.
 * @returns the multi-line next-step block.
 */
export function attachCallBlock(state) {
    const cards = state.panel.seats
        .filter(seat => seat.seat_id !== 'da')
        .map(seat => cardPlaceholder(seat.seat_id));
    return [
        'Next step - attach the field-analyst pass (human checkpoint 1):',
        '  academic_review_confirm(',
        '    review_id="' + state.review_id + '",',
        '    action="attach",',
        '    primary_discipline="<primary discipline>", secondary_disciplines=["<secondary discipline>"],',
        '    research_paradigm="<paradigm>", methodology_type="<methodology type>",',
        '    target_journal_tier="<tier>", paper_maturity="<maturity>",',
        '    configuration_cards=[' + (cards.length === 0 ? '' : '\n      ' + cards.join(',\n      ') + '\n    ') + ']',
        '  )',
        'Then show those cards to the user and record the checkpoint with academic_review_confirm(review_id="'
            + state.review_id + '", action="confirm") only after they approve them; no seat may be dispatched before that.',
    ];
}
/**
 * Render the successful result of `/ars-review`.
 * @param state - record created by the store.
 * @param store - store that owns the record.
 * @returns plain-text message.
 */
export function renderCreated(state, store) {
    const lines = [
        'Review ' + state.review_id + ' created (' + state.mode + ' mode, ' + String(state.panel.seats.length) + ' seat'
            + (state.panel.seats.length === 1 ? '' : 's') + ').',
        'Manuscript: ' + state.paper.path + ' (' + String(state.paper.bytes) + ' bytes, sha256 ' + state.paper.sha256 + ')',
        'Review directory: ' + store.directoryOf(state.review_id),
        'Seats:',
        ...seatLines(state),
    ];
    if (state.warnings.length > 0) {
        lines.push('Warnings:');
        for (const warning of state.warnings)
            lines.push('  - ' + warning);
    }
    lines.push(...attachCallBlock(state));
    return lines.join('\n');
}
/** The tool call that continues one review, keyed by its status. */
export function nextStepFor(summary, state) {
    const id = summary.review_id;
    switch (summary.status) {
        case 'created':
        case 'panel_configured':
            return 'attach the field analysis with academic_review_confirm(review_id="' + id + '", action="attach", ...) - '
                + 'see /' + REVIEW_COMMAND + ' output for the full call shape';
        case 'awaiting_panel_confirmation':
            return 'show the configuration cards to the user, then record checkpoint 1 with academic_review_confirm(review_id="'
                + id + '", action="confirm")';
        case 'in_review':
            return 'dispatch the open seats (' + summary.missing_seats.join(', ') + ') and commit each card with '
                + 'academic_review_submit(review_id="' + id + '", seat_id="<seat>", report={...})';
        case 'all_submitted':
            return 'synthesize the draft with academic_review_report(review_id="' + id + '") and leave approve unset';
        case 'awaiting_synthesis_approval':
            return 'ask the user to approve the draft letter, then call academic_review_report(review_id="' + id + '", approve=true)';
        case 'report_ready':
            return 'nothing is pending - the decision letter is ' + join(summary.review_dir, state.synthesis.decision_letter_path)
                + ' and the roadmap is ' + join(summary.review_dir, state.synthesis.revision_roadmap_path);
        case 'abandoned':
            return 'this review was abandoned - open a new one with /' + REVIEW_COMMAND + ' ' + REVIEW_COMMAND_HINT;
        default:
            return 'review the status above and continue with the academic_review_* tools';
    }
}
/**
 * Render the successful result of `/ars-review-status`.
 * @param summary - store status summary.
 * @param state - full record, for the advisory decision and report paths.
 * @returns plain-text message.
 */
export function renderStatus(summary, state) {
    const lines = [
        'Review ' + summary.review_id + ': ' + summary.status + ' (' + summary.mode + ' mode)',
        'Manuscript: ' + summary.paper_path,
        'Seats (' + String(summary.submitted_seats.length) + '/' + String(summary.required_seats.length) + ' submitted):',
    ];
    for (const seat of summary.seat_status) {
        lines.push('  - ' + seat.seat_id + ' (' + seat.role + '): ' + seat.status
            + (seat.verdict === null ? '' : ', verdict ' + seat.verdict));
    }
    lines.push('Pending checkpoint: ' + (summary.pending_checkpoint ?? 'none'));
    if (state.synthesis.decision !== null)
        lines.push('Decision: ' + state.synthesis.decision);
    if (summary.missing_seats.length > 0)
        lines.push('Still open: ' + summary.missing_seats.join(', '));
    if (state.warnings.length > 0) {
        lines.push('Warnings:');
        for (const warning of state.warnings)
            lines.push('  - ' + warning);
    }
    lines.push('Review directory: ' + summary.review_dir);
    lines.push('Next: ' + nextStepFor(summary, state));
    return lines.join('\n');
}
/** Wrap one command body so no thrown value can escape as a stack trace. */
async function run(body) {
    try {
        return await body();
    }
    catch (error) {
        return { kind: 'error', text: oneLine(error) };
    }
}
/**
 * Command definition for `/ars-review`.
 * @param config - resolved command configuration.
 * @returns the host registration definition.
 */
export function reviewCommandDefinition(config) {
    return {
        name: REVIEW_COMMAND,
        description: 'open a peer-review run for one manuscript (.md/.tex/.txt) through the review state layer',
        input: { hint: REVIEW_COMMAND_HINT },
        async handler(invocation) {
            return run(async () => {
                const input = parseReviewInput(invocation.rawInput);
                const store = storeFor(invocation.agent, config);
                const state = await store.create({ paperPath: input.paperPath, mode: input.mode });
                return { kind: 'success', text: renderCreated(state, store) };
            });
        },
    };
}
/**
 * Command definition for `/ars-review-status`.
 * @param config - resolved command configuration.
 * @returns the host registration definition.
 */
export function reviewStatusCommandDefinition(config) {
    return {
        name: REVIEW_STATUS_COMMAND,
        description: 'report one review (default: the newest in this workspace), its seats, checkpoint, and decision',
        input: { hint: REVIEW_STATUS_COMMAND_HINT },
        async handler(invocation) {
            return run(async () => {
                const store = storeFor(invocation.agent, config);
                const requested = unquote(invocation.rawInput);
                let reviewId = requested;
                if (reviewId === '') {
                    const reviews = await store.list();
                    const newest = reviews[0];
                    if (newest === undefined) {
                        throw new ReviewError('review_not_found', line([
                            'no reviews in ' + store.root + ' yet -',
                            'open one with /' + REVIEW_COMMAND + ' ' + REVIEW_COMMAND_HINT,
                        ]));
                    }
                    reviewId = newest.review_id;
                }
                else if (/\s/u.test(reviewId)) {
                    throw new CommandUsageError('/' + REVIEW_STATUS_COMMAND + ' takes one review id, e.g. '
                        + '"rev-20260101-0123abcd" (omit it to report the newest review)');
                }
                const state = await store.read(reviewId);
                const summary = await store.status(reviewId);
                return { kind: 'success', text: renderStatus(summary, state) };
            });
        },
    };
}
/**
 * Register both slash commands on the host command registry.
 *
 * The registry is reached lazily: `commands` is not a required inject, so a
 * composition without one still loads the tools and the skill.
 *
 * @param ctx - plugin context.
 * @param config - state-dir/workspace configuration shared with the tools.
 */
export function registerAcademicReviewCommands(ctx, config) {
    let registered = false;
    const register = () => {
        if (registered)
            return;
        const commands = ctx.get('commands');
        if (commands === undefined)
            return;
        registered = true;
        ctx.effect(() => commands.register(reviewCommandDefinition(config)), 'academic-review: /' + REVIEW_COMMAND);
        ctx.effect(() => commands.register(reviewStatusCommandDefinition(config)), 'academic-review: /' + REVIEW_STATUS_COMMAND);
    };
    register();
    ctx.on('internal/service', (serviceName) => {
        if (serviceName === 'commands')
            register();
    });
}
