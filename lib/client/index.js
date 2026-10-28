/** Browser plugin for the Academic Review right-sidebar panel. */
import { AcademicReviewPanel } from "./AcademicReviewPanel.js";
import { ACADEMIC_REVIEW_LOCALE_NAMESPACE, en, zh } from "./locales.js";
/** Required services: the browser locale registry and the slot registry. */
export const inject = ['locale', 'slots'];
/** Tab identity: the type id the pane body registers under, and the kind it opens by. */
export const ACADEMIC_REVIEW_TAB_ID = 'dsh-academic-skills/review-panel';
export const ACADEMIC_REVIEW_TAB_KIND = 'academic-review';
/**
 * Register the dictionaries and the right-sidebar tab that renders the review
 * panel. Discovery of review state happens inside the panel through the
 * plugin's read-only web routes, so registration itself carries no data.
 */
export function apply(rawCtx) {
    const ctx = rawCtx;
    ctx.effect(() => ctx.locale.register(ACADEMIC_REVIEW_LOCALE_NAMESPACE, { zh, en }), 'academic-review: dictionaries');
    // Optional service scope: when the right sidebar is absent (older hosts)
    // nothing panel-shaped mounts and the dictionaries stay registered.
    ctx.inject(['sidebarRight', 'sidebarRightTabs'], (native) => {
        const t = native.locale.bind(ACADEMIC_REVIEW_LOCALE_NAMESPACE);
        native.effect(() => native.sidebarRightTabs?.register({
            id: ACADEMIC_REVIEW_TAB_ID,
            kind: ACADEMIC_REVIEW_TAB_KIND,
            title: () => t('panel.title'),
        }));
        native.slots.inject('sidebar.right.pane.tab', () => native.slots.register({
            name: 'sidebar.right.pane.tab',
            key: ACADEMIC_REVIEW_TAB_ID,
            locale: ACADEMIC_REVIEW_LOCALE_NAMESPACE,
        }, AcademicReviewPanel));
    });
}
