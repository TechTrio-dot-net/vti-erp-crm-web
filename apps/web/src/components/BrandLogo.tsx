import Image from "next/image";
import { cn } from "@/lib/utils";

/** The yellow Voice Tunes India box mark, for use next to the name */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <Image
      src="/brand/logo-icon.png"
      alt="Voice Tunes India"
      width={size}
      height={size}
      priority
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

/** Full logo with the name underneath; use the white variant on dark backgrounds */
export function BrandLogo({ width = 200, variant = "dark", className }: { width?: number; variant?: "dark" | "white"; className?: string }) {
  return (
    <Image
      src={variant === "white" ? "/brand/logo-white.png" : "/brand/logo.png"}
      alt="Voice Tunes India"
      width={width}
      height={Math.round((width * 1631) / 3570)}
      priority
      className={cn("object-contain", className)}
    />
  );
}
