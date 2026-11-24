/**
 * EmojiPickerPopover — a lightweight emoji picker popover.
 * Uses emoji-picker-element (web component) wrapped in a React effect.
 */

import { Smile } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface EmojiPickerPopoverProps {
  onSelect: (emoji: string) => void;
  className?: string;
}

export default function EmojiPickerPopover({ onSelect, className = "" }: EmojiPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const container = containerRef.current;
    if (!container) return;

    // Dynamically create emoji-picker-element web component
    import("emoji-picker-element").then(() => {
      if (pickerRef.current) return; // already mounted
      const picker = document.createElement("emoji-picker");
      picker.setAttribute("class", "light"); // use built-in light theme, we override below
      (picker as HTMLElement).style.setProperty("--background", "#1e1e2a");
      (picker as HTMLElement).style.setProperty("--border-color", "#2d2d3a");
      (picker as HTMLElement).style.setProperty("--text-color", "#e5e5e5");
      (picker as HTMLElement).style.setProperty("--input-border-color", "#3a3a4a");
      (picker as HTMLElement).style.setProperty("--input-font-color", "#e5e5e5");
      (picker as HTMLElement).style.setProperty("--indicator-color", "#3b82f6");
      (picker as HTMLElement).style.setProperty("--button-active-background", "#3b82f640");
      (picker as HTMLElement).style.setProperty("--emoji-size", "1.3rem");
      (picker as HTMLElement).style.setProperty("--num-columns", "8");
      (picker as HTMLElement).style.height = "320px";
      (picker as HTMLElement).style.width = "280px";

      picker.addEventListener("emoji-click", (event: Event) => {
        const detail = (event as CustomEvent).detail;
        const emoji = detail?.unicode ?? detail?.emoji?.unicode ?? "";
        if (emoji) {
          onSelect(emoji);
          setOpen(false);
        }
      });

      container.appendChild(picker);
      pickerRef.current = picker;
    });

    // Close on outside click
    const handleOutside = (e: MouseEvent) => {
      const btn = document.getElementById("emoji-picker-btn");
      if (!container.contains(e.target as Node) && !btn?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
    };
  }, [open, onSelect]);

  // Clean up picker web component when popover closes
  useEffect(() => {
    if (!open && pickerRef.current) {
      pickerRef.current.remove();
      pickerRef.current = null;
    }
  }, [open]);

  return (
    <div className={`relative ${className}`}>
      <button
        id="emoji-picker-btn"
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="p-1.5 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
        title="Emoji"
        aria-label="Open emoji picker"
      >
        <Smile className="w-4 h-4" />
      </button>

      {open && (
        <div
          ref={containerRef}
          className="absolute bottom-9 left-0 z-50 rounded-xl overflow-hidden shadow-2xl border border-dona-border"
        />
      )}
    </div>
  );
}
