import { useMemo } from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return (
    <fieldset
      data-slot="field-set"
      className={cn(
        "rb:flex rb:flex-col rb:gap-6",
        "rb:has-[>[data-slot=checkbox-group]]:gap-3 rb:has-[>[data-slot=radio-group]]:gap-3",
        className
      )}
      {...props}
    />
  )
}

function FieldLegend({
  className,
  variant = "legend",
  ...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
  return (
    <legend
      data-slot="field-legend"
      data-variant={variant}
      className={cn(
        "rb:mb-3 rb:font-medium",
        "rb:data-[variant=legend]:text-base",
        "rb:data-[variant=label]:text-sm",
        className
      )}
      {...props}
    />
  )
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn(
        "rb:group/field-group rb:@container/field-group rb:flex rb:w-full rb:flex-col rb:gap-7 rb:data-[slot=checkbox-group]:gap-3 rb:[&>[data-slot=field-group]]:gap-4",
        className
      )}
      {...props}
    />
  )
}

// shadcn field. The CLI didn't prefix these arrays, so they're prefixed by hand. Spacing tightened to R Board's density.
const fieldVariants = cva(
  "rb:group/field rb:flex rb:w-full rb:min-w-0 rb:gap-1.5 rb:data-[invalid=true]:text-destructive",
  {
    variants: {
      orientation: {
        vertical: ["rb:flex-col rb:[&>*]:w-full rb:[&>.sr-only]:w-auto"],
        horizontal: [
          "rb:flex-row rb:items-center rb:gap-4",
          "rb:[&>[data-slot=field-label]]:flex-auto",
          "rb:has-[>[data-slot=field-content]]:items-start",
        ],
        responsive: [
          "rb:flex-col rb:@md/field-group:flex-row rb:@md/field-group:items-center rb:[&>*]:w-full rb:@md/field-group:[&>*]:w-auto rb:[&>.sr-only]:w-auto",
          "rb:@md/field-group:[&>[data-slot=field-label]]:flex-auto",
        ],
      },
    },
    defaultVariants: {
      orientation: "vertical",
    },
  }
)

function Field({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(fieldVariants({ orientation }), className)}
      {...props}
    />
  )
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-content"
      className={cn(
        "rb:group/field-content rb:flex rb:flex-1 rb:flex-col rb:gap-1.5 rb:leading-snug",
        className
      )}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        "rb:group/field-label rb:peer/field-label rb:flex rb:w-fit rb:gap-1.5 rb:leading-snug rb:group-data-[disabled=true]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-label"
      className={cn(
        "rb:flex rb:w-fit rb:items-center rb:gap-1.5 rb:text-control rb:leading-snug rb:font-medium rb:text-foreground rb:group-data-[disabled=true]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "rb:m-0 rb:text-hint rb:leading-snug rb:font-normal rb:text-faint-foreground",
        "rb:[&>a]:underline rb:[&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function FieldSeparator({
  children,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  children?: React.ReactNode
}) {
  return (
    <div
      data-slot="field-separator"
      data-content={!!children}
      className={cn(
        "rb:relative rb:-my-2 rb:h-5 rb:text-sm rb:group-data-[variant=outline]/field-group:-mb-2",
        className
      )}
      {...props}
    >
      <Separator className="rb:absolute rb:inset-0 rb:top-1/2" />
      {children && (
        <span
          className="rb:relative rb:mx-auto rb:block rb:w-fit rb:bg-background rb:px-2 rb:text-muted-foreground"
          data-slot="field-separator-content"
        >
          {children}
        </span>
      )}
    </div>
  )
}

function FieldError({
  className,
  children,
  errors,
  ...props
}: React.ComponentProps<"div"> & {
  errors?: Array<{ message?: string } | undefined>
}) {
  const content = useMemo(() => {
    if (children) {
      return children
    }

    if (!errors?.length) {
      return null
    }

    const uniqueErrors = [
      ...new Map(errors.map((error) => [error?.message, error])).values(),
    ]

    if (uniqueErrors?.length == 1) {
      return uniqueErrors[0]?.message
    }

    return (
      <ul className="rb:ml-4 rb:flex rb:list-disc rb:flex-col rb:gap-1">
        {uniqueErrors.map(
          (error, index) =>
            error?.message && <li key={index}>{error.message}</li>
        )}
      </ul>
    )
  }, [children, errors])

  if (!content) {
    return null
  }

  return (
    <div
      role="alert"
      data-slot="field-error"
      className={cn("rb:text-sm rb:font-normal rb:text-destructive", className)}
      {...props}
    >
      {content}
    </div>
  )
}

export {
  Field,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldContent,
  FieldTitle,
}
