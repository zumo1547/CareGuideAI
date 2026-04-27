import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

interface BrandLogoProps {
  href?: string;
  showText?: boolean;
  imageClassName?: string;
  className?: string;
  priority?: boolean;
  sizes?: string;
}

export const BrandLogo = ({
  href = "/",
  showText = true,
  imageClassName,
  className,
  priority = false,
  sizes = "(max-width: 768px) 120px, 160px",
}: BrandLogoProps) => {
  const content = (
    <div className={cn("inline-flex items-center gap-3", className)}>
      <Image
        src="/Logoweb/LogoWeb-web.png"
        alt="CareGuideAI Logo"
        width={168}
        height={168}
        priority={priority}
        sizes={sizes}
        className={cn("h-12 w-auto object-contain", imageClassName)}
      />
      {showText ? (
        <span className="text-base font-semibold tracking-wide text-cyan-800">CareGuideAI</span>
      ) : null}
    </div>
  );

  if (!href) {
    return content;
  }

  return (
    <Link href={href} className="inline-flex">
      {content}
    </Link>
  );
};
