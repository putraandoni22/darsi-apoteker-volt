import Image from "next/image";
import darsiLogo from "@/app/LOGO DARSI.png";
import { cn } from "@/lib/utils";

interface DarsiLogoProps {
  size?: number;
  withText?: boolean;
  title?: string;
  subtitle?: string;
  className?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  imageClassName?: string;
}

export function DarsiLogo({
  size = 44,
  withText = true,
  title = "DARSI",
  subtitle = "Digital Assistant for RSI Surabaya",
  className,
  titleClassName,
  subtitleClassName,
  imageClassName,
}: DarsiLogoProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn("relative shrink-0", imageClassName)}
        style={{ width: size, height: size }}
      >
        <Image
          src={darsiLogo}
          alt="Logo DARSI Apoteker"
          width={size}
          height={size}
          className="h-full w-full object-contain"
          priority
        />
      </div>

      {withText ? (
        <div>
          <p className={cn("font-bold text-lg tracking-tight", titleClassName)}>{title}</p>
          <p
            className={cn(
              "text-[11px] tracking-[0.12em] text-emerald-700 uppercase dark:text-emerald-300",
              subtitleClassName,
            )}
          >
            {subtitle}
          </p>
        </div>
      ) : null}
    </div>
  );
}
