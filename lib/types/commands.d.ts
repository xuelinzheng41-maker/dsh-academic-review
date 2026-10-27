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
import type { Context } from '@deepseek-ai/cordis';
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import { ReviewStore, type ReviewMode, type ReviewState, type ReviewStatusSummary } from './state.ts';
/** Name of the review-creation command (no leading slash). */
export declare const REVIEW_COMMAND = "ars-review";
/** Name of the review-status command (no leading slash). */
export declare const REVIEW_STATUS_COMMAND = "ars-review-status";
/** Input hint advertised for `/ars-review`. */
export declare const REVIEW_COMMAND_HINT = "[quick|full] <path-to-manuscript>";
/** Input hint advertised for `/ars-review-status`. */
export declare const REVIEW_STATUS_COMMAND_HINT = "[review_id]";
/** Resolved command configuration, shared with the tools' state layer. */
export interface AcademicReviewCommandsConfig {
    /** Review-state directory name under the workspace (default .academic-review). */
    readonly stateDir: string;
    /** Optional fixed workspace root; otherwise the calling session cwd is used. */
    readonly workspaceRoot?: string;
    /** Oversize warning threshold in bytes. */
    readonly maxPaperBytes?: number;
    /** Vendored upstream skill version recorded per review. */
    readonly upstreamSkillVersion?: string;
    /** Vendored upstream commit recorded per review. */
    readonly upstreamCommit?: string;
}
/** Refusal raised by the command grammar itself, before any state is touched. */
export declare class CommandUsageError extends Error {
    constructor(message: string);
}
/**
 * Flatten any thrown value to one actionable line.
 * @param error - thrown value.
 * @returns a single-line message with no stack trace and no newlines.
 */
export declare function oneLine(error: unknown): string;
/** One parsed `/ars-review` invocation. */
export interface ReviewCommandInput {
    /** Review mode; `full` when the argument is omitted. */
    mode: ReviewMode;
    /** Manuscript path exactly as the user typed it (quotes stripped). */
    paperPath: string;
}
/** Usage line shown whenever the create grammar does not parse. */
export declare function reviewUsage(): string;
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
export declare function parseReviewInput(rawInput: string): ReviewCommandInput;
/**
 * The exact `academic_review_confirm` attach call for one review.
 * @param state - freshly created record.
 * @returns the multi-line next-step block.
 */
export declare function attachCallBlock(state: ReviewState): string[];
/**
 * Render the successful result of `/ars-review`.
 * @param state - record created by the store.
 * @param store - store that owns the record.
 * @returns plain-text message.
 */
export declare function renderCreated(state: ReviewState, store: ReviewStore): string;
/** The tool call that continues one review, keyed by its status. */
export declare function nextStepFor(summary: ReviewStatusSummary, state: ReviewState): string;
/**
 * Render the successful result of `/ars-review-status`.
 * @param summary - store status summary.
 * @param state - full record, for the advisory decision and report paths.
 * @returns plain-text message.
 */
export declare function renderStatus(summary: ReviewStatusSummary, state: ReviewState): string;
/**
 * Command definition for `/ars-review`.
 * @param config - resolved command configuration.
 * @returns the host registration definition.
 */
export declare function reviewCommandDefinition(config: AcademicReviewCommandsConfig): CommandDefinition;
/**
 * Command definition for `/ars-review-status`.
 * @param config - resolved command configuration.
 * @returns the host registration definition.
 */
export declare function reviewStatusCommandDefinition(config: AcademicReviewCommandsConfig): CommandDefinition;
/**
 * Register both slash commands on the host command registry.
 *
 * The registry is reached lazily: `commands` is not a required inject, so a
 * composition without one still loads the tools and the skill.
 *
 * @param ctx - plugin context.
 * @param config - state-dir/workspace configuration shared with the tools.
 */
export declare function registerAcademicReviewCommands(ctx: Context, config: AcademicReviewCommandsConfig): void;
