import type { ReactNode } from "react";

export default function StreamingText({
  content,
  streaming = false,
}: {
  content: string;
  /** true = 仍在输出中，光标常亮；false = 完成，不显示光标 */
  streaming?: boolean;
}): ReactNode {
  return (
    <p className="text-ink text-sm leading-relaxed whitespace-pre-wrap">
      {content}
      {streaming && <span className="stream-caret is-streaming" />}
    </p>
  );
}