import { useState, useRef, useEffect, type FormEvent } from "react";
import { ArrowUp, Plus } from "lucide-react";
import { t } from "../../core/i18n";

const MIN_HEIGHT = 64;
const MAX_HEIGHT = 200;

export function Composer({ onSend }: { onSend: (text: string) => void }) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = `${MIN_HEIGHT}px`;
    el.style.overflowY = "hidden";
    const scrollH = el.scrollHeight;
    if (scrollH > MAX_HEIGHT) {
      el.style.height = `${MAX_HEIGHT}px`;
      el.style.overflowY = "auto";
    } else {
      el.style.height = `${Math.max(MIN_HEIGHT, scrollH)}px`;
    }
  }, [value]);

  const canSend = value.trim().length > 0;

  return (
    <form className="composer" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="composer-input"
        placeholder={t("composer.placeholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={1}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            handleSubmit(e as unknown as FormEvent);
          }
        }}
      />
      <div className="composer-bottom">
        <button type="button" className="composer-action" aria-label={t("composer.attach")}>
          <Plus size={16} strokeWidth={2} />
        </button>
        <button
          type="submit"
          className="composer-send"
          disabled={!canSend}
          aria-label={t("composer.send")}
        >
          <ArrowUp size={14} strokeWidth={2.4} />
        </button>
      </div>
    </form>
  );
}
