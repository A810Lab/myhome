import { classNames } from "../lib/format";

export function StatCard({
  icon: Icon,
  label,
  value,
  tone = "default",
  onClick
}: {
  icon: any;
  label: string;
  value: string;
  tone?: "default" | "good" | "warn";
  onClick?: () => void;
}) {
  return (
    <div 
      onClick={onClick}
      className={classNames(
        "rounded-xl border border-normal bg-elevated p-4 shadow-sm",
        onClick && "cursor-pointer hover:border-primary transition-colors duration-200"
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-neutral">{label}</span>
        <Icon
          className={classNames(
            "h-5 w-5",
            tone === "good" && "text-signal",
            tone === "warn" && "text-warn",
            tone === "default" && "text-neutral"
          )}
        />
      </div>
      <div className="mt-2 text-2xl font-bold text-strong">{value}</div>
    </div>
  );
}
