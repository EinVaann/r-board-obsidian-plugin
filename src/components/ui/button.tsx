import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

// shadcn button, values from the --rb-btn-* tokens. Which variant to use: styles/RULES.md.
const buttonVariants = cva(
  "rb:box-border rb:inline-flex rb:shrink-0 rb:items-center rb:justify-center rb:gap-1.5 rb:m-0 rb:whitespace-nowrap rb:border rb:border-solid rb:border-transparent rb:font-medium rb:leading-none rb:shadow-none rb:cursor-pointer rb:transition-colors rb:outline-none rb:focus-visible:ring-2 rb:focus-visible:ring-ring rb:disabled:pointer-events-none rb:disabled:opacity-45 rb:[&_svg]:pointer-events-none rb:[&_svg]:shrink-0 rb:[&_svg:not([class*=size-])]:size-icon-sm",
  {
    variants: {
      variant: {
        default: "rb:bg-primary rb:text-primary-foreground rb:shadow-button-primary rb:font-semibold rb:hover:brightness-95",
        destructive: "rb:bg-danger-surface rb:text-destructive rb:border-danger-border rb:hover:bg-danger-hover",
        outline: "rb:bg-secondary rb:text-secondary-foreground rb:border-secondary-border rb:shadow-button-secondary rb:hover:bg-secondary-hover",
        secondary: "rb:bg-secondary rb:text-secondary-foreground rb:border-secondary-border rb:shadow-button-secondary rb:hover:bg-secondary-hover",
        ghost: "rb:bg-transparent rb:text-ghost-foreground rb:hover:bg-accent rb:hover:text-accent-foreground",
        link: "rb:bg-transparent rb:text-foreground rb:underline-offset-4 rb:hover:underline",
      },
      size: {
        default: "rb:h-control rb:px-btn-px rb:rounded-button rb:text-control",
        xs: "rb:h-6 rb:gap-1 rb:px-2 rb:rounded-button-sm rb:text-hint rb:[&_svg:not([class*=size-])]:size-3",
        sm: "rb:h-control-sm rb:px-btn-px-sm rb:rounded-button-sm rb:text-control-sm",
        lg: "rb:h-10 rb:px-6 rb:rounded-button rb:text-control",
        icon: "rb:size-control-sm rb:p-0 rb:rounded-control-sm rb:[&_svg:not([class*=size-])]:size-icon",
        "icon-xs": "rb:size-5 rb:p-0 rb:rounded-control-sm rb:[&_svg:not([class*=size-])]:size-3",
        "icon-sm": "rb:size-icon-btn-sm rb:p-0 rb:rounded-control-sm",
        "icon-lg": "rb:size-control rb:p-0 rb:rounded-control rb:[&_svg:not([class*=size-])]:size-icon",
      },
    },
    compoundVariants: [
      // Icon-only buttons are quiet until hovered (row actions).
      { variant: "ghost", size: ["icon", "icon-xs", "icon-sm", "icon-lg"], class: "rb:text-icon-foreground" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
