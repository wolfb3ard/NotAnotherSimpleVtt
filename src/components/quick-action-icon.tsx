const paths = {
  sheet: 'M3 4h6l3 2 3-2h6v15h-6l-3 2-3-2H3z M12 6v15',
  rolls: 'm12 2 9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10',
  initiative: 'M5 20V4m0 1c5-4 9 4 14 0v9c-5 4-9-4-14 0',
  settings: 'M4 6h16M4 12h16M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  duplicate: 'M8 8h12v12H8z M16 8V4H4v12h4',
  assistance: 'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
  conditions: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z M8 12h2l2-4 2 7 2-3',
};

export function QuickActionIcon({ icon, label }: { icon: keyof typeof paths; label: string }) {
  return (
    <>
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={paths[icon]} />
      </svg>
      <span className="quick-action-label">{label}</span>
    </>
  );
}
