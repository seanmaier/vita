import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

// No rehype-raw: raw HTML in the source is rendered as text, never executed.
// react-markdown's default urlTransform also drops javascript: and similar URLs.
const components: Components = {
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[color:var(--accent)] underline underline-offset-2 hover:brightness-110"
    />
  ),
};

const wrapper = [
  '[font-family:var(--font-mono)] text-[12.5px] leading-[1.6] text-[color:var(--ink-invert)] break-words',
  '[&_h1]:text-[18px] [&_h1]:font-semibold [&_h1]:mt-5 [&_h1]:mb-2',
  '[&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:mt-5 [&_h2]:mb-2',
  '[&_h3]:text-[13.5px] [&_h3]:font-semibold [&_h3]:mt-4 [&_h3]:mb-1.5',
  '[&_h4]:text-[12.5px] [&_h4]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1',
  '[&_p]:my-2.5',
  '[&_ul]:list-disc [&_ul]:pl-5 [&_ul]:my-2.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:my-2.5 [&_li]:my-0.5',
  '[&_code]:bg-[color:var(--surface)] [&_code]:rounded [&_code]:px-1 [&_code]:py-px',
  '[&_pre]:bg-[color:var(--surface)] [&_pre]:border [&_pre]:border-[color:var(--rule)] [&_pre]:rounded-[5px] [&_pre]:p-3 [&_pre]:my-3 [&_pre]:overflow-x-auto',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-[color:var(--rule)] [&_blockquote]:pl-3 [&_blockquote]:my-3 [&_blockquote]:text-[color:var(--ink-2)]',
  '[&_table]:border-collapse [&_table]:my-3 [&_th]:border [&_th]:border-[color:var(--rule)] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-[color:var(--rule)] [&_td]:px-2 [&_td]:py-1',
  '[&_hr]:border-[color:var(--rule)] [&_hr]:my-4',
  '[&>*:first-child]:mt-0',
].join(' ');

export function MarkdownView({ source }: { source: string }) {
  return (
    <div className={wrapper}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
