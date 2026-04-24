import { ArrowRight, Search, X } from "lucide-react";
import type { ChangeEvent, FormEvent, ReactNode } from "react";

type TitlebarNavigationProps = {
  readonly value: string;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly isContextualAddress: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: () => void | Promise<void>;
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly trailingControl?: ReactNode;
};

export const TitlebarNavigation = ({
  value,
  placeholder,
  ariaLabel,
  isContextualAddress,
  onChange,
  onSubmit,
  onFocus,
  onBlur,
  trailingControl
}: TitlebarNavigationProps) => {
  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void onSubmit();
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange(event.target.value);
  };

  return (
    <form className="lyra-titlebar-navigation lyra-no-drag" onSubmit={handleSubmit}>
      <div
        className={
          isContextualAddress
            ? "lyra-titlebar-navigation-shell lyra-titlebar-navigation-shell-contextual"
            : "lyra-titlebar-navigation-shell"
        }
      >
        <span className="lyra-titlebar-navigation-icon" aria-hidden="true">
          <Search size={14} />
        </span>
        <input
          className="lyra-titlebar-navigation-input"
          type="text"
          value={value}
          placeholder={placeholder}
          aria-label={ariaLabel}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onChange={handleChange}
          onFocus={onFocus}
          onBlur={onBlur}
        />
        {trailingControl}
        {value.length > 0 ? (
          <button
            type="button"
            className="lyra-titlebar-navigation-action"
            aria-label={placeholder}
            onClick={() => {
              onChange("");
            }}
          >
            <X size={14} />
          </button>
        ) : null}
        <button
          type="submit"
          className="lyra-titlebar-navigation-action"
          aria-label={ariaLabel}
        >
          <ArrowRight size={14} />
        </button>
      </div>
    </form>
  );
};
