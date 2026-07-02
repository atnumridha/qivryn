import { vscForeground } from "..";

interface QivrynLogoProps {
  height?: number;
  width?: number;
}

export default function QivrynLogo({
  height = 128,
  width = 480,
}: QivrynLogoProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 480 128"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Qivryn"
      role="img"
    >
      <defs>
        <linearGradient
          id="qivryn-logo-gradient"
          x1="18"
          y1="16"
          x2="108"
          y2="112"
        >
          <stop stopColor="#7C5CFF" />
          <stop offset="1" stopColor="#2DE2E6" />
        </linearGradient>
      </defs>
      <circle
        cx="60"
        cy="60"
        r="43"
        stroke="url(#qivryn-logo-gradient)"
        strokeWidth="12"
      />
      <path
        d="M87 87L111 111"
        stroke="url(#qivryn-logo-gradient)"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="M50 47L37 60L50 73M70 47L83 60L70 73"
        stroke="url(#qivryn-logo-gradient)"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M60 51V72"
        stroke={vscForeground}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <circle cx="60" cy="75" r="6" fill={vscForeground} />
      <path
        d="M60 29L63.8 38.2L73 42L63.8 45.8L60 55L56.2 45.8L47 42L56.2 38.2L60 29Z"
        fill="#2DE2E6"
      />
      <text
        x="140"
        y="84"
        fill={vscForeground}
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize="64"
        fontWeight="650"
        letterSpacing="-2"
      >
        Qivryn
      </text>
    </svg>
  );
}
