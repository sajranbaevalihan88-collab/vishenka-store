import React from 'react';

const base = (size = 16) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': 'true',
});

export const IconPos = ({ size = 16 }) => (
  <svg {...base(size)}>
    <rect x="2" y="4" width="20" height="16" rx="2.5" />
    <path d="M2 10h20" />
    <path d="M6 15h4" />
    <path d="M15 15h3" />
  </svg>
);

export const IconChart = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M3 3v18h18" />
    <path d="m7 14 4-4 3 3 5-6" />
  </svg>
);

export const IconHanger = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M12 7a2 2 0 1 0-2-2" />
    <path d="M12 7v2.2a1 1 0 0 0 .45.83l8.1 5.4A1.5 1.5 0 0 1 19.72 18H4.28a1.5 1.5 0 0 1-.83-2.57l8.1-5.4A1 1 0 0 0 12 9.2" />
  </svg>
);

export const IconCalendar = ({ size = 16 }) => (
  <svg {...base(size)}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </svg>
);

export const IconSettings = ({ size = 16 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.08a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.08a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

export const IconBarcode = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M3 5v14M7 5v14M10 5v14M14 5v14M17 5v14M21 5v14" />
  </svg>
);

export const IconScan = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" />
    <path d="M7 8v8M11 8v8M15 8v8M17 8v8" />
  </svg>
);

export const IconPrinter = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M6 9V3h12v6" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="7" rx="1" />
  </svg>
);

export const IconReceipt = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M5 3v18l2.5-1.5L10 21l2-1.5L14 21l2.5-1.5L19 21V3l-2.5 1.5L14 3l-2 1.5L10 3 7.5 4.5 5 3Z" />
    <path d="M9 8h6M9 12h6M9 16h4" />
  </svg>
);

export const IconCash = ({ size = 16 }) => (
  <svg {...base(size)}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M6 12h.01M18 12h.01" />
  </svg>
);

export const IconQr = ({ size = 16 }) => (
  <svg {...base(size)}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3h-3zM20 14v3M14 20h7" />
  </svg>
);

export const IconSplit = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M16 3h5v5M8 3H3v5M12 22v-8.3a4 4 0 0 0-1.17-2.83L3 3M15 9l6-6" />
  </svg>
);

export const IconSearch = ({ size = 16 }) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const IconPlus = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconEdit = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
);

export const IconTrash = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
);

export const IconLogout = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </svg>
);

export const IconExternal = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

export const IconDownload = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export const IconUpload = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
  </svg>
);

export const IconRefresh = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
    <path d="M21 3v5h-5" />
  </svg>
);

export const IconCheck = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconBag = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M6 7h12l1 13H5L6 7Z" />
    <path d="M9 7a3 3 0 0 1 6 0" />
  </svg>
);

export const IconCamera = ({ size = 14 }) => (
  <svg {...base(size)}>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);

export const IconBox = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <path d="M3.3 7 12 12l8.7-5M12 22V12" />
  </svg>
);

export const IconTrend = ({ size = 16 }) => (
  <svg {...base(size)}>
    <path d="m22 7-8.5 8.5-5-5L2 17" />
    <path d="M16 7h6v6" />
  </svg>
);

export const IconInfo = ({ size = 15 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </svg>
);

export const IconArrowRight = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M5 12h14M13 5l7 7-7 7" />
  </svg>
);
