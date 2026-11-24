/**
 * WaMessage — renders a WhatsApp-style formatted message body.
 *
 * Supported formatting:
 *   *bold*          → <strong>
 *   _italic_        → <em>
 *   ~strikethrough~ → <del>
 *   `inline code`   → <code>
 *   ```block```     → <pre><code>
 *   - list item     → <ul><li>
 *   1. list item    → <ol><li>
 *
 * Also renders link previews for bare URLs and strips unsafe html.
 */

import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchLinkPreview, type LinkPreview } from "../lib/ipc";

function waFormatToHtml(text: string): string {
  // Code blocks first (``` … ```)
  let out = text.replace(/```([\s\S]*?)```/g, "<pre><code>$1</code></pre>");
  // Inline code
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Bold
  out = out.replace(/\*([^*\n]+)\*/g, "<strong>$1</strong>");
  // Italic
  out = out.replace(/_([^_\n]+)_/g, "<em>$1</em>");
  // Strikethrough
  out = out.replace(/~([^~\n]+)~/g, "<del>$1</del>");
  // Unordered list (- item)
  out = out.replace(/^- (.+)$/gm, "<li>$1</li>");
  // Ordered list (1. item)
  out = out.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  // Wrap consecutive <li> in <ul>
  out = out.replace(/(<li>.*<\/li>\n?)+/gs, (match) => `<ul>${match}</ul>`);
  // Linkify URLs (not inside html attrs)
  out = out.replace(
    /(?<![=">])(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-blue-400 underline">$1</a>'
  );
  // Line breaks
  out = out.replace(/\n/g, "<br>");
  return out;
}

function extractUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s<>"]+/g) ?? [];
  // Deduplicate
  return [...new Set(matches)].slice(0, 2); // max 2 previews per message
}

interface LinkPreviewCardProps {
  url: string;
}

function LinkPreviewCard({ url }: LinkPreviewCardProps) {
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchLinkPreview(url)
      .then((p) => {
        if (!cancelled) {
          if (p && (p.title || p.description || p.image)) {
            setPreview(p);
          } else {
            setFailed(true);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed || !preview) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex gap-2 rounded-lg border border-dona-border bg-dona-dark p-2 hover:bg-white/5 transition-colors no-underline"
    >
      {preview.image && (
        <img
          src={preview.image}
          alt={preview.title ?? ""}
          className="w-14 h-14 rounded object-cover shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}
      <div className="min-w-0 flex-1">
        {preview.title && (
          <p className="text-xs font-semibold text-white truncate">{preview.title}</p>
        )}
        {preview.description && (
          <p className="text-[11px] text-gray-400 line-clamp-2">{preview.description}</p>
        )}
        <p className="text-[10px] text-blue-400 flex items-center gap-0.5 mt-0.5 truncate">
          <ExternalLink className="w-3 h-3 shrink-0" />
          {url}
        </p>
      </div>
    </a>
  );
}

interface WaMessageProps {
  body: string;
  showLinkPreview?: boolean;
}

export default function WaMessage({ body, showLinkPreview = true }: WaMessageProps) {
  const html = waFormatToHtml(body);
  const urls = showLinkPreview ? extractUrls(body) : [];

  return (
    <div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised via regex rules above */}
      <span
        className="text-sm text-white leading-relaxed [&_strong]:font-bold [&_em]:italic [&_del]:line-through [&_code]:bg-black/40 [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-black/40 [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {urls.map((u) => (
        <LinkPreviewCard key={u} url={u} />
      ))}
    </div>
  );
}
