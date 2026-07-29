import React from "react";
import { classNames } from "../lib/format";

export function SectionCard({
  title,
  subtitle,
  right,
  children,
  className
}: {
  title?: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={classNames("rounded-xl border border-normal bg-elevated shadow-sm", className)}>
      {(title || right) && (
        <div className="flex items-center justify-between border-b border-normal px-5 py-4">
          <div>
            {title && <h2 className="text-lg font-bold text-strong leading-none">{title}</h2>}
            {subtitle && <p className="mt-1.5 text-sm text-neutral">{subtitle}</p>}
          </div>
          {right && <div>{right}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
