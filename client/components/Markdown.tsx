import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 把 AI 的 Markdown 文本渲染成带样式的 HTML。
 *
 * 自定义渲染：
 * - 代码块 → 深色背景 + 语言标签
 * - 行内代码 → 浅灰底 + 等宽字体
 * - 表格 → 可横向滚动容器
 * - 引用 → 左侧竖线
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="min-w-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 表格外层包一个可滚动的 div
          table: ({ children }) => (
            <div className="max-w-full overflow-x-auto my-2.5">
              <table className="border-collapse min-w-[520px] text-[13px]">
                {children}
              </table>
            </div>
          ),

          // 表头 / 表体行不额外包装
          thead: ({ children }) => <thead>{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,

          // 表格行
          tr: ({ children }) => (
            <tr className="border-b border-line last:border-0">
              {children}
            </tr>
          ),

          // 表头单元格
          th: ({ children }) => (
            <th className="border border-line text-left p-[6px_9px] bg-inset font-medium text-ink">
              {children}
            </th>
          ),

          // 表体单元格
          td: ({ children }) => (
            <td className="border border-line p-[6px_9px] text-ink-2">
              {children}
            </td>
          ),

          // 代码块 vs 行内代码，用 className 区分
          code: ({ className, children, ...props }) =>
            className ? (
              // ├─ 围栏代码块（有语言标注，如 language-ts）
              <div className="bg-[#1d1d1f] text-[#eee] rounded-md my-2.5 overflow-hidden">
                <div className="flex justify-between text-ink-3 p-[6px_9px] border-b border-[#333] text-[10px]">
                  <span>{className.replace("language-", "")}</span>
                </div>
                <pre className="overflow-auto p-[10px_11px] m-0 font-mono text-xs leading-relaxed">
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              </div>
            ) : (
              // ├─ 行内代码
              <code
                className="bg-field rounded-[3px] px-1 py-0.5 font-mono text-xs text-ink"
                {...props}
              >
                {children}
              </code>
            ),

          // 段落
          p: ({ children }) => (
            <p className="m-0 mb-2.5 last:mb-0 text-ink">{children}</p>
          ),

          // 标题
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold m-0 mb-2.5 text-ink">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold m-0 mb-1.5 mt-4 text-ink">
              {children}
            </h3>
          ),

          // 列表
          ul: ({ children }) => (
            <ul className="pl-5 my-1.5 text-ink">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="pl-5 my-1.5 text-ink">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="mb-0.5 text-ink-2">{children}</li>
          ),

          // 引用
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-line-strong my-2.5 pl-2.5 text-ink-2">
              {children}
            </blockquote>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}