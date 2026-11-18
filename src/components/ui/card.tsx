import * as React from "react"
import { cn } from "@/lib/utils"

// shadcn card, values from the --rb-surface-* tokens. Settings cards: CardHeader (icon · title · description · action) + CardContent.
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      className={cn(
        "rb:flex rb:flex-col rb:gap-2.5 rb:rounded-surface rb:border rb:border-solid rb:border-border rb:bg-card rb:px-4 rb:py-3.5 rb:text-card-foreground rb:shadow-surface",
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "rb:grid rb:auto-rows-min rb:grid-cols-[auto_1fr] rb:items-start rb:gap-x-3 rb:gap-y-0.5 rb:has-data-[slot=card-action]:grid-cols-[auto_1fr_auto]",
        className
      )}
      {...props}
    />
  )
}

function CardIcon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-icon"
      className={cn(
        "rb:row-span-2 rb:grid rb:size-7.5 rb:place-items-center rb:rounded-full rb:bg-accent rb:text-muted-foreground rb:[&_svg]:size-[15px]",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("rb:text-title rb:leading-snug rb:font-semibold rb:text-foreground", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("rb:col-start-2 rb:text-hint rb:leading-snug rb:text-faint-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "rb:col-start-3 rb:row-span-2 rb:row-start-1 rb:flex rb:items-center rb:gap-1 rb:self-start rb:justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("rb:flex rb:flex-col", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("rb:flex rb:items-center rb:justify-end rb:gap-2", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardHeader,
  CardIcon,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
