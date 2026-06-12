import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectTrigger,
  SelectValue
} from "../primitives";
import { cn } from "../utils";

const EMPTY_SELECT_VALUE = "__lyra_empty_select_value__";

export type AppSelectOption<TValue extends string = string> = {
  readonly description?: ReactNode;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
  readonly label: ReactNode;
  readonly value: TValue;
};

export type AppSelectProps<TValue extends string = string> = {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly contentClassName?: string;
  readonly disabled?: boolean;
  readonly onValueChange: (value: TValue) => void;
  readonly options: readonly AppSelectOption<TValue>[];
  readonly placeholder?: string;
  readonly value: TValue;
};

type AppSelectPreviewSide = "inline" | "left" | "right";

let activeAppSelectId: string | null = null;

const toRadixValue = (value: string): string =>
  value.length === 0 ? EMPTY_SELECT_VALUE : value;

const fromRadixValue = (value: string): string =>
  value === EMPTY_SELECT_VALUE ? "" : value;

export const AppSelect = <TValue extends string = string>({
  ariaLabel,
  className,
  contentClassName,
  disabled = false,
  onValueChange,
  options,
  placeholder,
  value
}: AppSelectProps<TValue>) => {
  const selectId = useId();
  const contentRef = useRef<HTMLDivElement | null>(null);
  const switchOpenFrameRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [previewValue, setPreviewValue] = useState<TValue | null>(null);
  const [previewSide, setPreviewSide] = useState<AppSelectPreviewSide>("right");
  const [previewMaxWidth, setPreviewMaxWidth] = useState<number | null>(null);
  const updatePreviewPlacement = useCallback(() => {
    const contentElement = contentRef.current;
    if (contentElement === null) return false;

    const rect = contentElement.getBoundingClientRect();
    const gap = 8;
    const viewportMargin = 8;
    const desiredWidth = 220;
    const minimumSideWidth = 160;
    const rightSpace = window.innerWidth - rect.right - gap - viewportMargin;
    const leftSpace = rect.left - gap - viewportMargin;
    const side = rightSpace >= desiredWidth || rightSpace >= leftSpace
      ? "right"
      : "left";
    const sideSpace = side === "right" ? rightSpace : leftSpace;

    if (sideSpace < minimumSideWidth) {
      setPreviewSide("inline");
      setPreviewMaxWidth(null);
      return true;
    }

    setPreviewSide(side);
    setPreviewMaxWidth(Math.min(desiredWidth, sideSpace));
    return true;
  }, []);
  const normalizedOptions = options.some((option) => option.value === value)
    ? options
    : value.length > 0
      ? [{ label: value, value }, ...options]
      : options;
  const hasOptions = normalizedOptions.length > 0;
  const renderedOptions = hasOptions
    ? normalizedOptions
    : [{
        disabled: true,
        label: placeholder ?? ariaLabel,
        value: "" as TValue
      }];
  const hasDescriptions = renderedOptions.some((option) => option.description !== undefined);
  const previewOption = useMemo(() => {
    if (previewValue === null) return null;
    return renderedOptions.find((option) => (
      option.value === previewValue && option.description !== undefined
    )) ?? null;
  }, [previewValue, renderedOptions]);
  const contentStyle = previewMaxWidth === null
    ? undefined
    : ({
        "--lyra-select-preview-max-width": `${previewMaxWidth}px`
      } as CSSProperties);

  useLayoutEffect(() => {
    if (!open || !hasDescriptions) return undefined;

    let animationFrame = 0;
    const schedulePlacementUpdate = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updatePreviewPlacement);
    };

    updatePreviewPlacement();
    window.addEventListener("resize", schedulePlacementUpdate);
    window.addEventListener("scroll", schedulePlacementUpdate, true);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", schedulePlacementUpdate);
      window.removeEventListener("scroll", schedulePlacementUpdate, true);
    };
  }, [hasDescriptions, open, updatePreviewPlacement]);

  useEffect(() => () => {
    if (activeAppSelectId === selectId) {
      activeAppSelectId = null;
    }
    if (switchOpenFrameRef.current !== null) {
      cancelAnimationFrame(switchOpenFrameRef.current);
    }
  }, [selectId]);

  const setSelectOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      activeAppSelectId = selectId;
      setPreviewValue(null);
      return;
    }
    if (activeAppSelectId === selectId) {
      activeAppSelectId = null;
    }
    setPreviewValue(null);
  };

  const showPreviewForOption = (option: AppSelectOption<TValue>) => {
    if (option.description === undefined) {
      setPreviewValue(null);
      return;
    }
    if (!updatePreviewPlacement()) {
      setPreviewSide("inline");
      setPreviewMaxWidth(null);
    }
    setPreviewValue(option.value);
  };

  return (
    <Select
      open={open}
      value={toRadixValue(value)}
      disabled={disabled || !hasOptions}
      onOpenChange={setSelectOpen}
      onValueChange={(nextValue) => {
        onValueChange(fromRadixValue(nextValue) as TValue);
      }}
    >
      <SelectTrigger
        className={cn("lyra-app-select", className)}
        aria-label={ariaLabel}
        onPointerDownCapture={() => {
          if (disabled || !hasOptions || activeAppSelectId === null || activeAppSelectId === selectId) {
            return;
          }
          if (switchOpenFrameRef.current !== null) {
            cancelAnimationFrame(switchOpenFrameRef.current);
          }
          switchOpenFrameRef.current = requestAnimationFrame(() => {
            switchOpenFrameRef.current = null;
            setSelectOpen(true);
          });
        }}
      >
        <span className="lyra-ui-select-trigger-value">
          <SelectValue placeholder={placeholder} />
        </span>
      </SelectTrigger>
      <SelectContent
        ref={contentRef}
        className={cn(
          hasDescriptions && "lyra-ui-select-content-with-preview",
          contentClassName
        )}
        data-preview-side={previewOption === null ? undefined : previewSide}
        style={contentStyle}
        onPointerLeave={() => {
          setPreviewValue(null);
        }}
        preview={previewOption === null ? null : (
          <aside className="lyra-ui-select-preview" aria-hidden="true">
            <strong className="lyra-ui-select-preview-title">
              {previewOption.label}
            </strong>
            <span className="lyra-ui-select-preview-description">
              {previewOption.description}
            </span>
          </aside>
        )}
      >
        {renderedOptions.map((option) => {
          const textValueProps = typeof option.label === "string"
            ? { textValue: option.label }
            : {};
          const disabledProps = option.disabled === undefined
            ? {}
            : { disabled: option.disabled };

          return (
            <SelectItem
              className={cn(
                option.icon === undefined ? undefined : "lyra-ui-select-item-with-icon",
                option.description === undefined ? undefined : "lyra-ui-select-item-with-description"
              )}
              key={option.value}
              value={toRadixValue(option.value)}
              onFocus={() => {
                showPreviewForOption(option);
              }}
              onPointerMove={() => {
                showPreviewForOption(option);
              }}
              {...disabledProps}
              {...textValueProps}
            >
              {option.icon === undefined ? null : (
                <span className="lyra-ui-select-item-icon" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              <span className="lyra-ui-select-item-copy">
                <SelectItemText>{option.label}</SelectItemText>
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};
