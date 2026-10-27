/** Browser plugin for the Academic Review right-sidebar panel. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AcademicReviewPanel } from './AcademicReviewPanel.tsx'
import { ACADEMIC_REVIEW_LOCALE_NAMESPACE, en, zh, type AcademicReviewLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Academic Review panel copy. */
    academicReview: AcademicReviewLocaleKey
  }
}

/**
 * Narrow client-context face this plugin consumes. The full declarations
 * (ctx.locale, ctx.slots, ctx.sidebarRight/…) come from the host client
 * bundles at runtime; a plugin bundle only needs this subset, kept local so
 * the typecheck does not depend on host-internal packages.
 */
interface ClientServices {
  effect(fn: () => (() => void) | void, label?: string): void
  /** Cordis service-scoped injection: the callback receives the named services. */
  inject(services: string[], scope: (native: NativeScope) => void): void
  locale: {
    register(ns: string, dicts: Record<string, Record<string, string>>): () => void
    bind(ns: string): (key: string, values?: Record<string, string | number>) => string
  }
  slots: {
    inject(name: string, factory: () => unknown, options?: unknown): void
    register(options: Record<string, unknown>, component: unknown): () => void
  }
}

interface NativeScope {
  effect(fn: () => (() => void) | void, label?: string): void
  locale: ClientServices['locale']
  slots: ClientServices['slots']
  sidebarRight: unknown
  sidebarRightTabs?: {
    register(definition: Record<string, unknown>): () => void
  }
}

/** Required services: the browser locale registry and the slot registry. */
export const inject = ['locale', 'slots']

/** Tab identity: the type id the pane body registers under, and the kind it opens by. */
export const ACADEMIC_REVIEW_TAB_ID = 'dsh-academic-review/review-panel'
export const ACADEMIC_REVIEW_TAB_KIND = 'academic-review'

/**
 * Register the dictionaries and the right-sidebar tab that renders the review
 * panel. Discovery of review state happens inside the panel through the
 * plugin's read-only web routes, so registration itself carries no data.
 */
export function apply(rawCtx: ClientContext): void {
  const ctx = rawCtx as unknown as ClientServices
  ctx.effect(
    () => ctx.locale.register(ACADEMIC_REVIEW_LOCALE_NAMESPACE, { zh, en }),
    'academic-review: dictionaries',
  )

  // Optional service scope: when the right sidebar is absent (older hosts)
  // nothing panel-shaped mounts and the dictionaries stay registered.
  ctx.inject(['sidebarRight', 'sidebarRightTabs'], (native) => {
    const t = native.locale.bind(ACADEMIC_REVIEW_LOCALE_NAMESPACE)
    native.effect(() => native.sidebarRightTabs?.register({
      id: ACADEMIC_REVIEW_TAB_ID,
      kind: ACADEMIC_REVIEW_TAB_KIND,
      title: () => t('panel.title'),
    }))
    native.slots.inject('sidebar.right.pane.tab', () => native.slots.register({
      name: 'sidebar.right.pane.tab',
      key: ACADEMIC_REVIEW_TAB_ID,
      locale: ACADEMIC_REVIEW_LOCALE_NAMESPACE,
    }, AcademicReviewPanel as unknown as (props: PropsLocale<'academicReview'>) => null))
  })
}
