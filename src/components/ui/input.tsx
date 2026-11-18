import * as React from "react"
import { cn } from "@/lib/utils"

// shadcn input, values from the --rb-field-* / --rb-control-* tokens. `data-size="sm"` for dense rows.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "rb:box-border rb:h-control rb:w-full rb:min-w-0 rb:m-0 rb:px-control-px rb:rounded-control rb:border rb:border-solid rb:border-input rb:bg-field rb:text-control rb:text-foreground rb:shadow-none rb:transition-colors rb:outline-none",
        "rb:placeholder:text-faint-foreground rb:hover:border-input-hover rb:disabled:pointer-events-none rb:disabled:cursor-not-allowed rb:disabled:opacity-50",
        "rb:data-[size=sm]:h-control-sm rb:data-[size=sm]:px-control-px-sm rb:data-[size=sm]:rounded-control-sm rb:data-[size=sm]:text-control-sm",
        "rb:focus-visible:border-ring rb:focus-visible:ring-2 rb:focus-visible:ring-ring/20",
        "rb:aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
