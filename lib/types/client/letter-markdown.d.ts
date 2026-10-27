/**
 * Sanitising markdown renderer for the editorial decision letter.
 *
 * The letter is model output. It is parsed with a deliberately small
 * block/inline grammar and turned into React nodes; the client never builds
 * HTML from it, so there is no dangerouslySetInnerHTML anywhere and no
 * injection path: anything the grammar does not recognise (raw tags included)
 * survives as an escaped text node.
 *
 * Supported blocks: ATX headings, paragraphs, bullet/ordered lists (nested by
 * indentation), block quotes, pipe tables, horizontal rules, fenced code.
 * Supported inline: `code`, **bold**, *emphasis*, _emphasis_.
 *
 * @module dsh-academic-review/client
 */
import type { ReactElement } from 'react';
/**
 * Render letter markdown as React nodes (never as HTML).
 * @param markdown - editorial decision letter.
 * @returns one element per parsed block.
 */
export declare function renderLetter(markdown: string): ReactElement[];
