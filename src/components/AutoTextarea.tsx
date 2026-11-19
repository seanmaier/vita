import { useLayoutEffect, useRef } from 'react';
import type { TextareaHTMLAttributes } from 'react';

type Props = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Empty lines kept below the text. */
  extraLines?: number;
};

export function AutoTextarea({ className, extraLines = 0, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    // scrollHeight is content + padding only; box-border sizing (Tailwind's
    // preflight default) needs the border included too, or the assigned
    // height ends up a couple px short and clips the last line.
    const borderY =
      style.boxSizing === 'border-box' ? parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth) : 0;
    // Collapsing the box below shrinks the page for a moment; on a long
    // document the browser clamps the scroll position meanwhile. Remember it
    // (window and scrollable ancestors) and put it back afterwards.
    const scrolled: [Element, number][] = [];
    let classMinHeight = 0;
    if (extraLines > 0) {
      scrolled.push([document.scrollingElement ?? document.documentElement, window.scrollY]);
      for (let a = el.parentElement; a; a = a.parentElement) {
        if (a.scrollTop > 0) scrolled.push([a, a.scrollTop]);
      }
      // The previous inline min-height (which includes the extra lines) would
      // otherwise feed into this measurement and keep the box from shrinking.
      // Read what the class gives once that inline value is gone.
      el.style.minHeight = '';
      classMinHeight = parseFloat(style.minHeight) || 0;
      el.style.minHeight = '0px';
    }
    el.style.height = 'auto';
    let extra = 0;
    if (extraLines > 0) {
      const parsed = parseFloat(style.lineHeight);
      extra = extraLines * (Number.isNaN(parsed) ? 1.2 * parseFloat(style.fontSize) : parsed);
    }
    const height = `${Math.max(el.scrollHeight + borderY + extra, classMinHeight)}px`;
    el.style.height = height;
    // A flex item's automatic minimum size resolves to 0 when its overflow
    // isn't visible (which is exactly our case), letting flex-shrink crush it
    // below content size in a tight column. An explicit min-height (unlike
    // flex-shrink: 0) blocks only that height-axis shrink, without also
    // preventing width-axis shrink where the textarea sits in a row
    // alongside another element (e.g. a remove button).
    el.style.minHeight = height;
    for (const [node, top] of scrolled) node.scrollTop = top;
  }, [rest.value, extraLines]);

  return <textarea ref={ref} className={className} style={{ resize: 'none', overflow: 'hidden' }} {...rest} />;
}
