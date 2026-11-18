import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronsUpDownIcon } from "lucide-react"

// shadcn native select (a real <select>: keyboard, typeahead and phones work as in Obsidian). Same box as Input.
function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default" }) {
  return (
    <div
      className={cn("rb:group/native-select rb:relative rb:inline-flex rb:min-w-0 rb:has-[select:disabled]:opacity-50", className)}
      data-slot="native-select-wrapper"
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          "rb:box-border rb:h-control rb:w-full rb:min-w-0 rb:m-0 rb:appearance-none rb:rounded-control rb:border rb:border-solid rb:border-input rb:bg-field rb:bg-none rb:py-0 rb:pl-control-px rb:pr-8 rb:text-control rb:text-foreground rb:shadow-none rb:cursor-pointer rb:transition-colors rb:outline-none",
          "rb:hover:border-input-hover rb:disabled:pointer-events-none rb:disabled:cursor-not-allowed",
          "rb:data-[size=sm]:h-control-sm rb:data-[size=sm]:rounded-control-sm rb:data-[size=sm]:pl-control-px-sm rb:data-[size=sm]:pr-7 rb:data-[size=sm]:text-control-sm",
          "rb:focus-visible:border-ring rb:focus-visible:ring-2 rb:focus-visible:ring-ring/20",
          "rb:aria-invalid:border-destructive"
        )}
        {...props}
      />
      {/* ⇅, not ⌄: ⌄ means "expand in place" (styles/RULES.md) and sits next to selects in list rows. */}
      <ChevronsUpDownIcon
        className="rb:pointer-events-none rb:absolute rb:top-1/2 rb:right-2.5 rb:size-3.5 rb:-translate-y-1/2 rb:text-muted-foreground rb:select-none"
        aria-hidden="true"
        data-slot="native-select-icon"
      />
    </div>
  )
}

function NativeSelectOption({
  className,
  ...props
}: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("rb:bg-popover rb:text-popover-foreground", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({
  className,
  ...props
}: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("rb:bg-popover rb:text-popover-foreground", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
