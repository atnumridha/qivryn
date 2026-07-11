import {
  ListboxButton as HLButton,
  ListboxOption as HLOption,
  ListboxOptions as HLOptions,
  Listbox as HLListbox,
} from "@headlessui/react";
import * as React from "react";
import { defaultBorderRadius, vscCommandCenterInactiveBorder } from "..";
import { cn } from "../../util/cn";
import { FontSizeModifier, useFontSize } from "./font";

const Listbox = HLListbox;

type ListboxButtonProps = React.ComponentProps<typeof HLButton> & {
  fontSizeModifier?: FontSizeModifier;
};

const ListboxButton = React.forwardRef<HTMLButtonElement, ListboxButtonProps>(
  ({ fontSizeModifier = -3, ...props }, ref) => {
    const fontSize = useFontSize(fontSizeModifier);
    return (
      <HLButton
        ref={ref}
        {...props}
        className={cn(
          "qivryn-listbox-trigger bg-vsc-input-background text-vsc-foreground border-border focus-visible:ring-border-focus m-0 flex min-h-7 flex-1 cursor-pointer flex-row items-center gap-1.5 border border-solid px-2 py-1 text-left transition-colors duration-150 focus-visible:ring-1",
          props.className,
        )}
        style={{
          fontSize,
          borderRadius: defaultBorderRadius,
          ...props.style,
        }}
      />
    );
  },
);

type ListboxOptionsProps = React.ComponentProps<typeof HLOptions> & {
  fontSizeModifier?: FontSizeModifier;
};
const ListboxOptions = React.forwardRef<HTMLUListElement, ListboxOptionsProps>(
  ({ fontSizeModifier = -3, ...props }, ref) => {
    const fontSize = useFontSize(fontSizeModifier);
    return (
      <HLOptions
        ref={ref}
        anchor={"bottom start"}
        {...props}
        className={cn(
          "qivryn-listbox-menu bg-vsc-input-background flex w-max min-w-0 max-w-[min(400px,calc(100vw-16px))] flex-col overflow-auto overscroll-contain p-1 shadow-md",
          props.className,
        )}
        style={{
          border: `1px solid ${vscCommandCenterInactiveBorder}`,
          fontSize,
          borderRadius: defaultBorderRadius,
          zIndex: 200000,
          ...props.style,
        }}
      />
    );
  },
);

type ListboxOptionProps = React.ComponentProps<typeof HLOption> & {
  fontSizeModifier?: FontSizeModifier;
};
const ListboxOption = React.forwardRef<HTMLLIElement, ListboxOptionProps>(
  ({ fontSizeModifier = -3, ...props }, ref) => {
    const fontSize = useFontSize(fontSizeModifier);
    return (
      <HLOption
        ref={ref}
        {...props}
        className={cn(
          "qivryn-listbox-option text-foreground flex min-h-8 select-none flex-row items-center justify-between gap-2 rounded px-2 py-1.5 transition-colors duration-150",
          props.disabled
            ? "opacity-50"
            : "background-transparent data-[focus]:bg-list-hover data-[selected]:bg-list-active data-[selected]:text-list-active-foreground hover:bg-list-hover hover:text-foreground cursor-pointer opacity-100",
          props.className,
        )}
        style={{
          fontSize,
          ...props.style,
        }}
      />
    );
  },
);

export { Listbox, ListboxButton, ListboxOption, ListboxOptions };
