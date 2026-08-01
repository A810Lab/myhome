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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-normal px-5 py-4 gap-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-lg font-bold text-strong leading-none">{title}</h2>}
            {subtitle && <p className="mt-1.5 text-sm text-neutral leading-normal">{subtitle}</p>}
          </div>
          {right && <div className="w-full sm:w-auto flex justify-start sm:justify-end shrink-0">{right}</div>}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
