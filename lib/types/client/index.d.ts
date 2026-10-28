/** Browser plugin for the Academic Review right-sidebar panel. */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type AcademicReviewLocaleKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Academic Review panel copy. */
        academicReview: AcademicReviewLocaleKey;
    }
}
/** Required services: the browser locale registry and the slot registry. */
export declare const inject: string[];
/** Tab identity: the type id the pane body registers under, and the kind it opens by. */
export declare const ACADEMIC_REVIEW_TAB_ID = "dsh-academic-skills/review-panel";
export declare const ACADEMIC_REVIEW_TAB_KIND = "academic-review";
/**
 * Register the dictionaries and the right-sidebar tab that renders the review
 * panel. Discovery of review state happens inside the panel through the
 * plugin's read-only web routes, so registration itself carries no data.
 */
export declare function apply(rawCtx: ClientContext): void;
