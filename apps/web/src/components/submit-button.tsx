"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant } from "./ui";

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  name,
  value,
  confirm,
}: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  name?: string;
  value?: string;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      name={name}
      value={value}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "Working..." : children}
    </Button>
  );
}
