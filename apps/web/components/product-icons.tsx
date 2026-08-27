export type ProductIconName =
  | "work"
  | "reviews"
  | "projects"
  | "policies"
  | "evidence"
  | "insights"
  | "setup"
  | "settings"
  | "docs"
  | "menu"
  | "close";

const paths: Record<ProductIconName, string> = {
  work: "M4 6.5h16v13H4zM8 6.5V4h8v2.5M8 12h8m-8 4h5",
  reviews: "M5 4h14v16H5zM8 8h8m-8 4h8m-8 4h5",
  projects: "M4 7h6l2 2h8v10H4z",
  policies: "M6 3.5h9l3 3V20H6zM14.5 3.5V7H18M9 11h6m-6 4h6",
  evidence: "M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6zM9 12l2 2 4-5",
  insights: "M5 19V9m5 10V5m5 14v-7m4 7V3",
  setup: "M4 7h16M7 4v6m10 3v7m-3-4h6M4 16h6",
  settings:
    "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19 12l2-1-2-3-2.2.2L15.5 6 12 5 10.5 7.2 8 8 6 6.8 3.5 9 4.6 12 3.5 15 6 17.2 8 16l2.5.8L12 19l3.5-1 1.3-2.2 2.2.2 2-3z",
  docs: "M5 4h10l4 4v12H5zM14 4v5h5M8 13h8m-8 3h6",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "m6 6 12 12M18 6 6 18",
};

export type ProductIconProps = Readonly<{ name: ProductIconName; size?: number }>;

export function ProductIcon({ name, size = 18 }: ProductIconProps) {
  return (
    <svg aria-hidden="true" className="product-icon" width={size} height={size} viewBox="0 0 24 24" focusable="false">
      <path
        d={paths[name]}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
